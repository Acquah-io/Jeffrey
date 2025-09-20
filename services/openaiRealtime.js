const EventEmitter = require('events');
const WebSocket = require('ws');
const { PassThrough } = require('stream');
const { v4: uuidv4 } = require('uuid');

const REALTIME_ENDPOINT = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-09-12';
const DEFAULT_VOICE = process.env.JEFFREY_REALTIME_VOICE || 'alloy';
const RESPONSE_TIMEOUT_MS = Number(process.env.JEFFREY_REALTIME_TIMEOUT_MS || 8000);

class OpenAIRealtimeClient extends EventEmitter {
  constructor({ guildId, model = DEFAULT_MODEL, voice = DEFAULT_VOICE } = {}) {
    super();
    this.guildId = guildId;
    this.model = model;
    this.voice = voice;
    this.ws = null;
    this.pending = new Map();
    this.connected = false;
    this.connecting = false;
    this.instructions = process.env.JEFFREY_REALTIME_INSTRUCTIONS || 'You are Jeffrey, a helpful classroom assistant. Always respond in English. Keep answers concise and conversational.';
  }

  async ensureConnection() {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) {
      await new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          this.off('connected', onReady);
          this.off('error', onError);
        };
        this.on('connected', onReady);
        this.on('error', onError);
      });
      return;
    }

    this.connecting = true;
    const url = `${REALTIME_ENDPOINT}?model=${encodeURIComponent(this.model)}`;
    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    };

    this.ws = new WebSocket(url, { headers });

    this.ws.on('open', () => {
      this.connected = true;
      this.connecting = false;
      this.send({
        type: 'session.update',
        session: {
          instructions: this.instructions,
          voice: this.voice,
        },
      });
      this.emit('connected');
    });

    this.ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        this.handleMessage(payload);
      } catch (err) {
        this.emit('error', err);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this.pending.forEach((entry) => {
        const err = new Error('Realtime connection closed');
        entry.initialReject(err);
        entry.finalReject(err);
        if (entry.timeout) clearTimeout(entry.timeout);
      });
      this.pending.clear();
      this.emit('disconnected');
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Realtime connection is not open');
    }
    this.ws.send(JSON.stringify(message));
  }

  async sendUserMessage({ text, clientState }) {
    await this.ensureConnection();

    const responseId = uuidv4();
    const entry = {
      text: '',
      audioStream: new PassThrough({ highWaterMark: 1 << 20 }),
      timeout: null,
      initialResolved: false,
    };

    let initialResolve;
    let initialReject;
    const initialPromise = new Promise((resolve, reject) => {
      initialResolve = resolve;
      initialReject = reject;
    });

    entry.initialResolve = (value) => {
      if (entry.initialResolved) return;
      entry.initialResolved = true;
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.timeout = setTimeout(() => {
        if (this.pending.has(responseId)) {
          entry.finalReject(new Error('Realtime response timeout'));
          this.pending.delete(responseId);
        }
      }, RESPONSE_TIMEOUT_MS);
      initialResolve(value);
    };
    entry.initialReject = (err) => {
      if (entry.initialResolved) return;
      entry.initialResolved = true;
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.audioStream.destroy(err);
      initialReject(err);
    };

    const finalPromise = new Promise((resolve, reject) => {
      entry.finalResolve = (value) => {
        entry.audioStream.end();
        resolve(value);
      };
      entry.finalReject = (err) => {
        entry.audioStream.destroy(err);
        reject(err);
      };
    });

    entry.timeout = setTimeout(() => {
      if (this.pending.has(responseId)) {
        entry.initialReject(new Error('Realtime response timeout'));
        entry.finalReject(new Error('Realtime response timeout'));
        this.pending.delete(responseId);
      }
    }, RESPONSE_TIMEOUT_MS);

    entry.finalPromise = finalPromise;
    this.pending.set(responseId, entry);

    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text },
        ],
      },
    });

    if (clientState) {
      this.send({
        type: 'client.event',
        event: {
          type: 'conversation_state.update',
          state: clientState,
        },
      });
    }

    this.send({
      type: 'response.create',
      response: {
        id: responseId,
        modalities: ['audio', 'text'],
        instructions: 'Respond conversationally in English. Provide an audio reply.',
        audio: {
          voice: this.voice,
          format: 'mp3',
        },
      },
    });

    return initialPromise.then(() => ({
      audioStream: entry.audioStream,
      textPromise: entry.finalPromise,
    }));
  }

  handleMessage(message) {
    if (!message) return;
    const { type } = message;
    switch (type) {
      case 'response.output_text.delta':
      case 'response.output_text': {
        const pending = this.pending.get(message.response_id || message.response?.id);
        if (pending && message.delta) {
          pending.text += message.delta;
          pending.initialResolve({ started: false });
        } else if (pending && message.output_text) {
          pending.text += message.output_text;
          pending.initialResolve({ started: false });
        }
        break;
      }
      case 'response.output_audio.delta': {
        const pending = this.pending.get(message.response_id || message.response?.id);
        if (pending && message.delta) {
          try {
            const chunk = Buffer.from(message.delta, 'base64');
            pending.audioStream.write(chunk);
            pending.initialResolve({ started: true });
          } catch (err) {
            pending.audioStream.destroy(err);
            pending.initialReject(err);
          }
        }
        break;
      }
      case 'response.completed': {
        const pending = this.pending.get(message.response?.id || message.id);
        if (pending) {
          pending.initialResolve({ started: false });
          pending.finalResolve(pending.text.trim());
          if (pending.timeout) clearTimeout(pending.timeout);
          this.pending.delete(message.response?.id || message.id);
        }
        break;
      }
      case 'error': {
        const pending = this.pending.get(message.response?.id || message.id);
        if (pending) {
          const err = new Error(message.error?.message || 'Realtime API error');
          pending.initialReject(err);
          pending.finalReject(err);
          if (pending.timeout) clearTimeout(pending.timeout);
          this.pending.delete(message.response?.id || message.id);
        }
        break;
      }
      default:
        // Helpful for debugging unexpected events
        if (process.env.JEFFREY_DEBUG_REALTIME === '1') {
          console.debug('[Realtime] Unhandled message type:', type);
        }
        break;
    }
  }
}

const sessionCache = new Map();

function getRealtimeClient(guildId) {
  if (!guildId) throw new Error('guildId required');
  if (!sessionCache.has(guildId)) {
    sessionCache.set(guildId, new OpenAIRealtimeClient({ guildId }));
  }
  return sessionCache.get(guildId);
}

module.exports = {
  getRealtimeClient,
};
