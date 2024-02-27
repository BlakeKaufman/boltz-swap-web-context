import { ClaimReverseSubmarineSwapProps, claimReverseSubmarineSwap } from './src/claim-reverse-submarine-swap';
import { ClaimSubmarineSwapProps, claimSubmarineSwap } from './src/claim-submarie-swap';

declare global {
  interface Window {
    claimReverseSubmarineSwap: (props: ClaimReverseSubmarineSwapProps) => void
    claimSubmarineSwap: (props: ClaimSubmarineSwapProps) => void
    ReactNativeWebView: {
      postMessage: (string: string) => void
    }
  }
}

window.claimReverseSubmarineSwap = async (args: ClaimReverseSubmarineSwapProps) => {
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      tx: await claimReverseSubmarineSwap(args)
    }))
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: e.message }))
  }
}

window.claimSubmarineSwap = async (args: ClaimSubmarineSwapProps) => {
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      result: await claimSubmarineSwap(args)
    }))
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: e.message }))
  }
}