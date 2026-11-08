export async function callServerGemini(params: {
  model?: string;
  contents: any;
  config?: any;
}): Promise<{ text?: string }> {
  const response = await fetch('/api/gemini/generate-content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server Gemini error (${response.status})`);
  }

  return await response.json();
}
