export const postFinalReverseSubmarineSwap = async (apiUrl: string, body: { hex: string }) => {
  const response = await fetch(`${apiUrl}/v2/chain/L-BTC/transaction`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify(body),
  })

  return response.json()
}
