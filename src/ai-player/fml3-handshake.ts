/**
 * FML3 Handshake Handler for Forge 1.20.1
 *
 * Forge servers require clients to complete an FML3 mod negotiation during login.
 * minecraft-protocol auto-responds with "not understood" which Forge rejects.
 * This module intercepts login_plugin_request packets and speaks proper FML3:
 *
 * 1. Server sends S2CModList (its mods, channels, registries)
 * 2. We reply C2SModListReply echoing the same lists (pretending we have them all)
 * 3. Server sends S2CRegistry / S2CConfigData packets
 * 4. We acknowledge each one
 * 5. Login completes — we're in!
 */

import { logger } from '../utils/logger.js';

// --- VarInt encoding/decoding (MC protocol standard) ---

function readVarInt(buf: Buffer, offset: number): [value: number, newOffset: number] {
  let value = 0;
  let size = 0;
  let byte: number;
  do {
    if (offset + size >= buf.length) throw new Error('VarInt: buffer underflow');
    byte = buf[offset + size];
    value |= (byte & 0x7f) << (size * 7);
    size++;
    if (size > 5) throw new Error('VarInt: too big');
  } while (byte & 0x80);
  return [value, offset + size];
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let temp = value & 0x7f;
    value >>>= 7;
    if (value !== 0) temp |= 0x80;
    bytes.push(temp);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readString(buf: Buffer, offset: number): [value: string, newOffset: number] {
  const [length, start] = readVarInt(buf, offset);
  if (start + length > buf.length) throw new Error('String: buffer underflow');
  const str = buf.toString('utf8', start, start + length);
  return [str, start + length];
}

function writeString(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

// --- FML3 packet types ---
// These IDs match Forge 1.20.1's FMLHandshakeMessages registration order
const S2C_MOD_LIST = 1;
const C2S_MOD_LIST_REPLY = 2;
const S2C_REGISTRY = 3;
const S2C_CONFIG_DATA = 4;
const C2S_ACKNOWLEDGE = 99;

interface ServerModList {
  mods: string[];
  channels: Array<{ name: string; version: string }>;
  registries: string[];
}

function parseS2CModList(payload: Buffer, offset: number): ServerModList {
  const mods: string[] = [];
  const channels: Array<{ name: string; version: string }> = [];
  const registries: string[] = [];

  // Mods
  let [modCount, pos] = readVarInt(payload, offset);
  for (let i = 0; i < modCount; i++) {
    let mod: string;
    [mod, pos] = readString(payload, pos);
    mods.push(mod);
  }

  // Channels (name + version pairs)
  let channelCount: number;
  [channelCount, pos] = readVarInt(payload, pos);
  for (let i = 0; i < channelCount; i++) {
    let name: string, version: string;
    [name, pos] = readString(payload, pos);
    [version, pos] = readString(payload, pos);
    channels.push({ name, version });
  }

  // Registries (just names)
  let registryCount: number;
  [registryCount, pos] = readVarInt(payload, pos);
  for (let i = 0; i < registryCount; i++) {
    let reg: string;
    [reg, pos] = readString(payload, pos);
    registries.push(reg);
  }

  return { mods, channels, registries };
}

function buildC2SModListReply(server: ServerModList): Buffer {
  const parts: Buffer[] = [];

  // Packet ID
  parts.push(writeVarInt(C2S_MOD_LIST_REPLY));

  // Echo mod list — claim we have all the same mods
  parts.push(writeVarInt(server.mods.length));
  for (const mod of server.mods) {
    parts.push(writeString(mod));
  }

  // Echo channels
  parts.push(writeVarInt(server.channels.length));
  for (const ch of server.channels) {
    parts.push(writeString(ch.name));
    parts.push(writeString(ch.version));
  }

  // Registries — as key-value pairs with empty hash (server sends real data next)
  parts.push(writeVarInt(server.registries.length));
  for (const reg of server.registries) {
    parts.push(writeString(reg));
    parts.push(writeString('')); // empty hash
  }

  return Buffer.concat(parts);
}

function buildAcknowledge(): Buffer {
  return writeVarInt(C2S_ACKNOWLEDGE);
}

// --- Login wrapper encoding ---
// FML3 wraps inner handshake packets inside fml:loginwrapper

function unwrapLoginPacket(data: Buffer): { channel: string; payload: Buffer } {
  const [channel, offset] = readString(data, 0);
  return { channel, payload: data.subarray(offset) };
}

function wrapLoginPacket(innerChannel: string, innerData: Buffer): Buffer {
  return Buffer.concat([writeString(innerChannel), innerData]);
}

// --- FML3 packet handler ---

function handleLoginPluginRequest(client: any, packet: any): void {
  const { messageId, channel, data } = packet;

  logger.info(`FML3: Received login_plugin_request msgId=${messageId} channel="${channel}" dataLen=${data?.length ?? 'null'}`);

  // Non-FML3 channels — respond with "not understood" (vanilla behavior)
  if (channel !== 'fml:loginwrapper' || !data) {
    logger.info(`FML3: Non-FML3 channel "${channel}", responding with "not understood"`);
    client.write('login_plugin_response', {
      messageId,
      data: undefined,
    });
    return;
  }

  try {
    const inner = unwrapLoginPacket(data);
    const [packetId, offset] = readVarInt(inner.payload, 0);

    logger.info(`FML3: Inner packet ID=${packetId} on channel="${inner.channel}" (${inner.payload.length} bytes)`);

    if (packetId === S2C_MOD_LIST) {
      const serverMods = parseS2CModList(inner.payload, offset);
      logger.info(
        `FML3: Server has ${serverMods.mods.length} mods, ` +
        `${serverMods.channels.length} channels, ` +
        `${serverMods.registries.length} registries`
      );

      const reply = buildC2SModListReply(serverMods);
      const wrapped = wrapLoginPacket(inner.channel, reply);
      logger.info(`FML3: Sending mod list reply (${wrapped.length} bytes)`);
      client.write('login_plugin_response', {
        messageId,
        data: wrapped,
      });

    } else if (packetId === S2C_REGISTRY || packetId === S2C_CONFIG_DATA) {
      const ack = buildAcknowledge();
      const wrapped = wrapLoginPacket(inner.channel, ack);
      logger.info(`FML3: Acknowledging packet ID=${packetId} (${wrapped.length} bytes)`);
      client.write('login_plugin_response', {
        messageId,
        data: wrapped,
      });

    } else {
      // Unknown FML3 packet — acknowledge it generically
      const ack = buildAcknowledge();
      const wrapped = wrapLoginPacket(inner.channel, ack);
      logger.info(`FML3: Acknowledging unknown packet ID=${packetId}`);
      client.write('login_plugin_response', {
        messageId,
        data: wrapped,
      });
    }

  } catch (err) {
    logger.error('FML3: Error handling packet:', err);
    // Fall back to "not understood" so we don't hang
    client.write('login_plugin_response', {
      messageId,
      data: undefined,
    });
  }
}

// --- Main setup function ---

/**
 * Install FML3 handshake handler on a minecraft-protocol client.
 * Call immediately after mineflayer.createBot().
 *
 * Uses emit override to guarantee we intercept login_plugin_request
 * before any default handler can auto-respond.
 */
export function setupFML3Handshake(client: any): void {
  // Override emit to intercept login_plugin_request at the source.
  // This is more reliable than removeAllListeners because it doesn't
  // matter when the default handler is registered — we catch the event
  // before ANY handler sees it.
  const originalEmit = client.emit.bind(client);

  client.emit = function (event: string, ...args: any[]) {
    if (event === 'login_plugin_request') {
      handleLoginPluginRequest(client, args[0]);
      return true; // Event "handled" — default handler never fires
    }
    return originalEmit(event, ...args);
  };

  logger.info(`FML3: Installed handshake handler (emit override)`);
}
