export async function sendTelegramAlert(chatId: string, message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    })
  })
}

export function formatTradeAlert(
  wallet: string,
  asset: string,
  side: string,
  size: number,
  leverage: number,
  price: number
): string {
  const sideEmoji = side === 'long' ? '🟢' : '🔴'
  return `${sideEmoji} *New Position Opened*\n\nWallet: \`${wallet.slice(0, 8)}...\`\nAsset: *${asset}*\nSide: ${side.toUpperCase()}\nSize: $${size.toLocaleString()}\nLeverage: ${leverage}x\nPrice: $${price.toLocaleString()}`
}
