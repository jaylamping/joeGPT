import type { RequestHandler } from '@sveltejs/kit';
import type { ChatCompletionRequestMessage, CreateChatCompletionRequest } from 'openai';
import { getTokens } from '../../../lib/tokenizer';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		/* check for openAI key */
		if (!process.env.OPENAI_API_KEY) {
			throw new Error('OPEN_AI_KEY variable not set');
		}

		const requestData = await request.json();

		if (!requestData) {
			throw new Error('No request data');
		}

		const reqMessages: ChatCompletionRequestMessage[] = requestData.messages;

		if (!reqMessages) {
			throw new Error('No messages provided');
		}

		/* calculate token count */
		let tokenCount = 0;
		reqMessages.forEach((msg) => {
			const tokens = getTokens(msg.content);
			tokenCount += tokens;
		});

		/* check to ensure data we are passing is not flagged */
		const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
			headers: {
				'Content-Type:': 'application/json',
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
			},
			method: 'POST',
			body: JSON.stringify({
				input: reqMessages[reqMessages.length - 1].content
			})
		});

		const moderationData = await moderationRes.json();
		const [results] = moderationData.results;

		if (results.flagged) {
			throw new Error('Query flagged by OpenAI. Stop being gross');
		}

		const prompt =
			'You are a sarcastic gentleman from the late seventeenth century. Your name is Sir Bittlebops.';

		/* recalculate tokens */
		tokenCount += getTokens(prompt);
		if (tokenCount >= 4096) {
			throw new Error('Query too large. Token limit exceeded.');
		}

		/* initialize messages array for conversation */
		const messages: ChatCompletionRequestMessage[] = [
			{ role: 'system', content: prompt },
			...reqMessages
		];

		/* build out request options */
		const chatRequestOpts: CreateChatCompletionRequest = {
			model: 'gpt-3.5-turbo',
			messages,
			temperature: 0.9,
			stream: true
		};

		/* grab ai response */
		const chatResponse = await fetch('http://api.openai.com/v1/chat/completions', {
			headers: {
				'Content-Type:': 'application/json',
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
			},
			method: 'POST',
			body: JSON.stringify(chatRequestOpts)
		});

		if (!chatResponse.ok) {
			const err = await chatResponse.json();
			throw new Error(err);
		}

		/* return text stream to application */
		return new Response(chatResponse.body, {
			headers: {
				'Content-Type': 'text/event-stream'
			}
		});
	} catch (err) {
		console.error(err);
		return json({ error: 'There was an error processing your request' }, { status: 500 });
	}
};
