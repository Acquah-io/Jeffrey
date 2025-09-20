const EventEmitter = require('events');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const REALTIME_ENDPOINT = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-09-12';
const DEFAULT_VOICE = process.env.JEFFREY_REALTIME_VOICE || 'alloy';

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
        entry.reject(new Error('Realtime connection closed'));
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
    const resultPromise = new Promise((resolve, reject) => {
      this.pending.set(responseId, {
        resolve,
        reject,
        text: '',
        audioChunks: [],
      });
    });

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

    return resultPromise;
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
        } else if (pending && message.output_text) {
          pending.text += message.output_text;
        }
        break;
      }
      case 'response.output_audio.delta': {
        const pending = this.pending.get(message.response_id || message.response?.id);
        if (pending && message.delta) {
          try {
            const chunk = Buffer.from(message.delta, 'base64');
            pending.audioChunks.push(chunk);
          } catch (_) {}
        }
        break;
      }
      case 'response.completed': {
        const pending = this.pending.get(message.response?.id || message.id);
        if (pending) {
          const audioBuffer = pending.audioChunks.length ? Buffer.concat(pending.audioChunks) : null;
          pending.resolve({ text: pending.text.trim(), audio: audioBuffer });
          this.pending.delete(message.response?.id || message.id);
        }
        break;
      }
      case 'error': {
        const pending = this.pending.get(message.response?.id || message.id);
        if (pending) {
          pending.reject(new Error(message.error?.message || 'Realtime API error'));
          this.pending.delete(message.response?.id || message.id);
        }
        break;
      }
      default:
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
