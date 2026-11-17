import { describe, test, expect, vi } from 'vitest';
import WS from 'vitest-websocket-mock';
import Stream from '../src/streaming.js';

describe('Streaming', () => {
	test('useChannel', async () => {
		const server = new WS('wss://misskey.test/streaming');
		const stream = new Stream('https://misskey.test', { token: 'TOKEN' });
		const mainChannelReceived: any[] = [];
		const main = stream.useChannel('main');
		main.on('meUpdated', payload => {
			mainChannelReceived.push(payload);
		});

		const ws = await server.connected;
		expect(new URLSearchParams(new URL(ws.url).search).get('i')).toEqual('TOKEN');

		const msg = JSON.parse(await server.nextMessage as string);
		const mainChannelId = msg.body.id;
		expect(msg.type).toEqual('connect');
		expect(msg.body.channel).toEqual('main');
		expect(mainChannelId != null).toEqual(true);

		server.send(JSON.stringify({
			type: 'channel',
			body: {
				id: mainChannelId,
				type: 'meUpdated',
				body: {
					id: 'foo'
				}
			}
		}));

		expect(mainChannelReceived[0]).toEqual({
			id: 'foo'
		});

		stream.close();
		server.close();
	});

	test('useChannel with parameters', async () => {
		const server = new WS('wss://misskey.test/streaming');
		const stream = new Stream('https://misskey.test', { token: 'TOKEN' });
		const chatChannelReceived: any[] = [];
		const chat = stream.useChannel('chat', { other: 'aaa' });
		chat.on('message', payload => {
			chatChannelReceived.push(payload);
		});

		const ws = await server.connected;
		expect(new URLSearchParams(new URL(ws.url).search).get('i')).toEqual('TOKEN');

		const msg = JSON.parse(await server.nextMessage as string);
		const chatChannelId = msg.body.id;
		expect(msg.type).toEqual('connect');
		expect(msg.body.channel).toEqual('chat');
		expect(msg.body.params).toEqual({ other: 'aaa' });
		expect(chatChannelId != null).toEqual(true);

		server.send(JSON.stringify({
			type: 'channel',
			body: {
				id: chatChannelId,
				type: 'message',
				body: {
					id: 'foo'
				}
			}
		}));

		expect(chatChannelReceived[0]).toEqual({
			id: 'foo'
		});

		stream.close();
		server.close();
	});

	test('ちゃんとチャンネルごとにidが異なる', async () => {
		const server = new WS('wss://misskey.test/streaming');
		const stream = new Stream('https://misskey.test', { token: 'TOKEN' });

		stream.useChannel('chat', { other: 'aaa' });
		stream.useChannel('chat', { other: 'bbb' });

		const ws = await server.connected;
		expect(new URLSearchParams(new URL(ws.url).search).get('i')).toEqual('TOKEN');

		const msg = JSON.parse(await server.nextMessage as string);
		const chatChannelId = msg.body.id;
		const msg2 = JSON.parse(await server.nextMessage as string);
		const chatChannelId2 = msg2.body.id;

		expect(chatChannelId != null).toEqual(true);
		expect(chatChannelId2 != null).toEqual(true);
		expect(chatChannelId).not.toEqual(chatChannelId2);

		stream.close();
		server.close();
	});

	test('Connection#send', async () => {
		const server = new WS('wss://misskey.test/streaming');
		const stream = new Stream('https://misskey.test', { token: 'TOKEN' });

		const chat = stream.useChannel('chat', { other: 'aaa' });
		chat.send('read', { id: 'aaa' });

		const ws = await server.connected;
		expect(new URLSearchParams(new URL(ws.url).search).get('i')).toEqual('TOKEN');

		const connectMsg = JSON.parse(await server.nextMessage as string);
		const channelId = connectMsg.body.id;
		const msg = JSON.parse(await server.nextMessage as string);

		expect(msg.type).toEqual('ch');
		expect(msg.body.id).toEqual(channelId);
		expect(msg.body.type).toEqual('read');
		expect(msg.body.body).toEqual({ id: 'aaa' });

		stream.close();
		server.close();
	});

	test('Connection#dispose', async () => {
		const server = new WS('wss://misskey.test/streaming');
		const stream = new Stream('https://misskey.test', { token: 'TOKEN' });
		const mainChannelReceived: any[] = [];
		const main = stream.useChannel('main');
		main.on('meUpdated', payload => {
			mainChannelReceived.push(payload);
		});

		const ws = await server.connected;
		expect(new URLSearchParams(new URL(ws.url).search).get('i')).toEqual('TOKEN');

		const msg = JSON.parse(await server.nextMessage as string);
		const mainChannelId = msg.body.id;
		expect(msg.type).toEqual('connect');
		expect(msg.body.channel).toEqual('main');
		expect(mainChannelId != null).toEqual(true);
		main.dispose();

		server.send(JSON.stringify({
			type: 'channel',
			body: {
				id: mainChannelId,
				type: 'meUpdated',
				body: {
					id: 'foo'
				}
			}
		}));

		expect(mainChannelReceived.length).toEqual(0);

		stream.close();
		server.close();
	});

	test('reconnect restores subscriptions before recovering state', async () => {
		const server = new WS('ws://localhost:61819/streaming');
		const stream = new Stream('http://localhost:61819', { token: 'LOCAL_SESSION' }, { client: 'web-v1' });
		stream.useChannel('main');
		stream.useChannel('homeTimeline', { withRenotes: false });
		const socket = await server.connected;
		expect(new URL(socket.url).searchParams.get('client')).toBe('web-v1');
		await server.nextMessage;
		await server.nextMessage;
		const recovery = vi.fn(() => stream.send('recovery-ready'));
		stream.on('_reconnected_', recovery);
		socket.close({ code: 1006, reason: 'local interruption', wasClean: false });
		await vi.waitFor(() => expect(stream.state).toBe('reconnecting'));
		stream.reconnect();
		const main = JSON.parse(await server.nextMessage as string);
		const home = JSON.parse(await server.nextMessage as string);
		expect(main.body.channel).toBe('main');
		expect(home.body.channel).toBe('homeTimeline');
		expect(home.body.params).toEqual({ withRenotes: false });
		expect(JSON.parse(await server.nextMessage as string).type).toBe('recovery-ready');
		expect(recovery).toHaveBeenCalledOnce();
		stream.close();
		server.close();
	});

	test('revoked sessions stop reconnecting and emit authentication failure', async () => {
		const server = new WS('ws://localhost:61820/streaming');
		const stream = new Stream('http://localhost:61820', { token: 'LOCAL_SESSION' });
		const failed = vi.fn();
		stream.on('_authenticationFailed_', failed);
		const socket = await server.connected;
		socket.close({ code: 4001, reason: 'Client session revoked', wasClean: true });
		await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
		await new Promise(resolve => setTimeout(resolve, 550));
		expect(server.server.clients().length).toBe(0);
		stream.close();
		server.close();
	});

	// TODO: SharedConnection#dispose して一定時間経ったら disconnect メッセージがサーバーに送られてくるかのテスト

	// TODO: チャンネル接続が使いまわされるかのテスト
});
