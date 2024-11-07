import * as ecc from '@bitcoinerlab/secp256k1'
import zkpInit from '@vulpemventures/secp256k1-zkp'
import { Musig, OutputType, SwapTreeSerializer, detectSwap, targetFee } from 'boltz-core'
import { TaprootUtils as LiquidTaprootUtils, constructRefundTransaction, init } from 'boltz-core/dist/lib/liquid'
import { Buffer } from 'buffer'
import { randomBytes } from 'crypto'
import ECPairFactory from 'ecpair'
import { Transaction as LiquidTransaction } from 'liquidjs-lib'
import { getSubmarineTransaction } from './boltz-api/getSubmarineTransaction'
import { postSubmarineSwapRefundDetails } from './boltz-api/postSubmarineSwapRefundDetails'
import { SubmarineResponse } from './boltz-api/types'
import { FEE_ESTIMATION_BUFFER, SESSION_ID_BYTES } from './constants'
import { decodeLiquidAddress } from './utils/decodeLiquidAddress'
import { LiquidNetworkId, getNetwork } from './utils/getNetwork'
const ECPair = ECPairFactory(ecc)

export type RefundSubmarineSwapProps = {
  apiUrl: string
  network: LiquidNetworkId
  address: string
  feeRate: number
  swapInfo: SubmarineResponse

  /** hex encoded */
  privateKey: string
}
export const refundSubmarineSwap = async ({
  address,
  feeRate = 1,
  swapInfo,
  privateKey,
  apiUrl,
  network: networkId,
}: RefundSubmarineSwapProps) => {
  const { id, claimPublicKey, swapTree } = swapInfo
  const network = getNetwork(networkId)
  if (!claimPublicKey || !swapTree) throw Error('GENERAL_ERROR')

  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {
    network,
  })
  const boltzPublicKey = Buffer.from(claimPublicKey, 'hex')

  const zkp = await zkpInit()
  init(zkp)

  // Create a musig signing session and tweak it with the Taptree of the swap scripts
  const musig = new Musig(zkp, keyPair, randomBytes(SESSION_ID_BYTES), [boltzPublicKey, keyPair.publicKey])
  const tweakedKey = LiquidTaprootUtils.tweakMusig(musig, SwapTreeSerializer.deserializeSwapTree(swapTree).tree)

  // Parse the lockup transaction and find the output relevant for the swap
  const submarineTransaction = await getSubmarineTransaction(id, apiUrl)
  if ('error' in submarineTransaction) throw Error(submarineTransaction.error)

  const lockupTx = LiquidTransaction.fromHex(submarineTransaction.hex)
  const swapOutput = detectSwap(tweakedKey, lockupTx)

  if (swapOutput === undefined) throw Error('No swap output found in lockup transaction')

  const decodedAddress = decodeLiquidAddress(address, network)
  const liquidRefundDetails = [
    {
      ...swapOutput,
      keys: keyPair,
      cooperative: true,
      blindingPrivateKey: swapInfo.blindingKey ? Buffer.from(swapInfo.blindingKey, 'hex') : undefined,
      type: OutputType.Taproot,
      txHash: lockupTx.getHash(),
    },
  ]
  // Create a claim transaction to be signed cooperatively via a key path spend
  const refundTx = targetFee(feeRate, (fee: number) =>
    constructRefundTransaction(
      liquidRefundDetails,
      decodedAddress.script,
      0,
      fee + FEE_ESTIMATION_BUFFER,
      true,
      network,
      decodedAddress.blindingKey
    )
  )

  // Get the partial signature from Boltz
  const boltzSig = await postSubmarineSwapRefundDetails(id, apiUrl, {
    index: 0,
    transaction: refundTx.toHex(),
    pubNonce: Buffer.from(musig.getPublicNonce()).toString('hex'),
  })

  musig.aggregateNonces([[boltzPublicKey, Musig.parsePubNonce(boltzSig.pubNonce)]])

  // Initialize the session to sign the claim transaction
  musig.initializeSession(LiquidTaprootUtils.hashForWitnessV1(network, liquidRefundDetails, refundTx, 0))

  // Add the partial signature from Boltz
  musig.addPartial(boltzPublicKey, Buffer.from(boltzSig.partialSignature, 'hex'))
  // Create our partial signature
  musig.signPartial()

  // Witness of the input to the aggregated signature
  refundTx.ins[0].witness = [musig.aggregatePartials()]
  return { tx: refundTx.toHex(), id: id }
}
