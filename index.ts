import {
  ClaimReverseSubmarineSwapProps,
  claimReverseSubmarineSwap,
} from "./src/claim-reverse-submarine-swap";
import {
  ClaimSubmarineSwapProps,
  claimSubmarineSwap,
} from "./src/claim-submarine-swap";
import {
  RefundSubmarineSwapProps,
  refundSubmarineSwap,
} from "./src/refund-submarine-swap";

declare global {
  interface Window {
    claimReverseSubmarineSwap: (props: ClaimReverseSubmarineSwapProps) => void;
    claimSubmarineSwap: (props: ClaimSubmarineSwapProps) => void;
    refundSubmarineSwap: (props: RefundSubmarineSwapProps) => void;
    ReactNativeWebView: {
      postMessage: (string: string) => void;
    };
  }
}

window.claimReverseSubmarineSwap = async (
  args: ClaimReverseSubmarineSwapProps
) => {
  try {
    const claimResponse: { tx: string; id: string } =
      await claimReverseSubmarineSwap(args);
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        tx: claimResponse.tx,
        id: claimResponse.id,
      })
    );
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: e.message }));
  }
};

window.claimSubmarineSwap = async (args: ClaimSubmarineSwapProps) => {
  try {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        result: await claimSubmarineSwap(args),
      })
    );
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: e.message }));
  }
};

window.refundSubmarineSwap = async (args: RefundSubmarineSwapProps) => {
  const refundResponse: { tx: string; id: string } = await refundSubmarineSwap(
    args
  );
  try {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        refundTx: refundResponse.tx,
        id: refundResponse.id,
      })
    );
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: e.message }));
  }
};
