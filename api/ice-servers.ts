import type {IceServerConfig} from '../src/types/stream.ts';

export function GET(): Response {
  const iceServers: IceServerConfig[] = [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun1.l.google.com:19302'},
    {urls: 'stun:stun2.l.google.com:19302'},
  ];

  if (process.env.TURN_URL) {
    const turnConfig: IceServerConfig = {
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (process.env.TURN_USERNAME) {
      turnConfig.username = process.env.TURN_USERNAME;
    }
    if (process.env.TURN_CREDENTIAL) {
      turnConfig.credential = process.env.TURN_CREDENTIAL;
    }
    iceServers.push(turnConfig);
  }

  return new Response(JSON.stringify({iceServers}), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
