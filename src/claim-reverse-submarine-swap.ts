import * as ecc from '@bitcoinerlab/secp256k1'
import zkpInit from '@vulpemventures/secp256k1-zkp'
import { Musig, OutputType, SwapTreeSerializer, detectSwap, targetFee } from 'boltz-core'
// import { TaprootUtils as LiquidTaprootUtils, constructClaimTransaction, init } from 'boltz-core/dist/lib/liquid'
import { TaprootUtils, constructClaimTransaction, init } from 'boltz-core/dist/lib/liquid'
import { Buffer } from 'buffer'
import { randomBytes } from 'crypto'
import ECPairFactory from 'ecpair'
import { Transaction, address as addressLib } from 'liquidjs-lib'
import { getSwapStatus } from './boltz-api/getSwapStatus'
import { postClaimReverseSubmarineSwap } from './boltz-api/postClaimReverseSubmarineSwap'
import { ReverseResponse } from './boltz-api/types'
import { FEE_ESTIMATION_BUFFER, SESSION_ID_BYTES } from './constants'
import { decodeLiquidAddress } from './utils/decodeLiquidAddress'
import { LiquidNetworkId, getNetwork } from './utils/getNetwork'
const ECPair = ECPairFactory(ecc)

export type ClaimReverseSubmarineSwapProps = {
  apiUrl: string
  network: LiquidNetworkId
  address: string
  feeRate: number
  swapInfo: ReverseResponse

  /** hex encoded */
  privateKey: string

  /** hex encoded */
  preimage: string

  swapStatusTx: string
}

export const claimReverseSubmarineSwap = async ({
  address,
  feeRate = 0.11,
  swapInfo,
  privateKey,
  preimage,
  apiUrl,
  network: networkId,
  swapStatusTx,
}: ClaimReverseSubmarineSwapProps) => {
  init(await zkpInit())
  const { id, refundPublicKey, swapTree } = swapInfo
  const swapStatus = await getSwapStatus(id, apiUrl)
  const network = getNetwork(networkId)
  if (!refundPublicKey || !swapTree) throw Error('GENERAL_ERROR')
  if (!swapStatus.transaction?.hex) throw Error('LOCK_TRANSACTION_MISSING')

  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'))
  const boltzPublicKey = Buffer.from(refundPublicKey, 'hex')

  // Create a musig signing session and tweak it with the Taptree of the swap scripts
  const musig = new Musig(await zkpInit(), keyPair, randomBytes(32), [boltzPublicKey, keyPair.publicKey])
  const tweakedKey = TaprootUtils.tweakMusig(musig, SwapTreeSerializer.deserializeSwapTree(swapTree).tree)

  // Parse the lockup transaction and find the output relevant for the swap

  const lockupTx = Transaction.fromHex(swapStatus.transaction?.hex)
  const swapOutput = detectSwap(tweakedKey, lockupTx)

  if (swapOutput === undefined) throw Error('No swap output found in lockup transaction')

  // const decodedAddress = decodeLiquidAddress(address, network)
  // window.ReactNativeWebView.postMessage(JSON.stringify(decodedAddress))
  const liquidClaimDetails = [
    {
      ...swapOutput,
      keys: keyPair,
      preimage: Buffer.from(preimage, 'hex'),
      cooperative: true,
      type: OutputType.Taproot,
      txHash: lockupTx.getHash(),
      blindingPrivateKey: Buffer.from(swapInfo.blindingKey, 'hex'),
    },
  ]

  // Create a claim transaction to be signed cooperatively via a key path spend
  const claimTx = targetFee(feeRate, (fee: number) =>
    constructClaimTransaction(
      liquidClaimDetails,
      addressLib.toOutputScript(address, network),
      fee,
      true,
      network,
      addressLib.fromConfidential(address).blindingKey
    )
  )

  if (!claimTx.toHex()) throw Error('No claim TX created')
  // Get the partial signature from Boltz

  const boltzSig = await postClaimReverseSubmarineSwap(id, apiUrl, {
    index: 0,
    transaction: claimTx.toHex(),
    preimage,
    pubNonce: Buffer.from(musig.getPublicNonce()).toString('hex'),
  })

  // musig.aggregateNonces([[boltzPublicKey, Musig.parsePubNonce(boltzSig.pubNonce)]])
  musig.aggregateNonces([[boltzPublicKey, Buffer.from(boltzSig.pubNonce, 'hex')]])

  // Initialize the session to sign the claim transaction
  musig.initializeSession(
    claimTx.hashForWitnessV1(
      0,
      [swapOutput.script],
      [{ asset: swapOutput.asset, value: swapOutput.value }],
      Transaction.SIGHASH_DEFAULT,
      network.genesisBlockHash
    )
  )

  // Add the partial signature from Boltz
  musig.addPartial(boltzPublicKey, Buffer.from(boltzSig.partialSignature, 'hex'))

  // Create our partial signature
  musig.signPartial()

  // Witness of the input to the aggregated signature
  claimTx.ins[0].witness = [musig.aggregatePartials()]

  return { tx: claimTx.toHex(), id: swapInfo.id }
}
