export async function sendNtfyAlert(
  topic: string,
  title: string,
  message: string,
  priority: 1 | 3 | 5 = 3
) {
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Title': title,
      'Priority': priority.toString(),
      'Tags': 'chart_with_upwards_trend',
    },
    body: message
  })
}
