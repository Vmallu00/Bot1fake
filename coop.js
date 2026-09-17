'use strict';

const database = require('./database');

function normalizeUsername(username) {
  if (!username) return '';

  return String(username)
    .trim()
    .replace(/^@/, '')
    .replace(/\s+/g, '_');
}

function sameUsername(a, b) {
  return normalizeUsername(a).toLowerCase() ===
    normalizeUsername(b).toLowerCase();
}

function createRequest(botId, requester, target = null) {
  const request = {
    id: `coop_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,

    botId: String(botId),

    requester: normalizeUsername(requester),
    target: target ? normalizeUsername(target) : null,

    status: 'pending',
    accepted: false,

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  database.saveCoop(request);

  return request;
}

function getRequest(id) {
  return database.getCoop(id);
}

function listRequests(botId) {
  const requests = database.listCoop();

  if (!botId) {
    return requests;
  }

  return requests.filter(
    request => String(request.botId) === String(botId)
  );
}

function getPendingRequests(botId) {
  return listRequests(botId).filter(
    request => request.status === 'pending'
  );
}

function isExpectedRequester(request, expectedUsername) {
  if (!request) return false;

  return sameUsername(
    request.requester,
    expectedUsername
  );
}

function acceptRequest(bot, requestId) {
  const request = database.getCoop(requestId);

  if (!request) {
    throw new Error('Co-op request not found.');
  }

  if (request.status !== 'pending') {
    throw new Error(
      `Co-op request is already ${request.status}.`
    );
  }

  if (!bot || typeof bot.acceptCoop !== 'function') {
    throw new Error(
      'This bot does not support co-op acceptance.'
    );
  }

  /*
   * The bot itself is responsible for sending the
   * server-specific acceptance command.
   */
  bot.acceptCoop(request.requester);

  request.status = 'accepted';
  request.accepted = true;
  request.updatedAt = new Date().toISOString();

  database.saveCoop(request);

  return request;
}

function rejectRequest(bot, requestId) {
  const request = database.getCoop(requestId);

  if (!request) {
    throw new Error('Co-op request not found.');
  }

  if (request.status !== 'pending') {
    throw new Error(
      `Co-op request is already ${request.status}.`
    );
  }

  if (!bot) {
    throw new Error('Bot is not available.');
  }

  /*
   * FakePixel may use a server-specific command.
   * The bot's rejectCoop() method can override this.
   */
  if (typeof bot.rejectCoop === 'function') {
    bot.rejectCoop(request.requester);
  } else {
    bot.sendCommand?.(
      `/coopdeny ${request.requester}`
    );
  }

  request.status = 'rejected';
  request.accepted = false;
  request.updatedAt = new Date().toISOString();

  database.saveCoop(request);

  return request;
}

function findExpectedRequest(
  botId,
  expectedUsername
) {
  return getPendingRequests(botId).find(
    request =>
      isExpectedRequester(
        request,
        expectedUsername
      )
  ) || null;
}

function markConfirmed(
  botId,
  username
) {
  const requests = listRequests(botId);

  const request = requests.find(
    item =>
      sameUsername(item.requester, username)
  );

  if (!request) {
    return null;
  }

  request.status = 'confirmed';
  request.accepted = true;
  request.updatedAt = new Date().toISOString();

  database.saveCoop(request);

  return request;
}

function markFailed(
  requestId,
  reason = 'Co-op request failed'
) {
  const request = database.getCoop(requestId);

  if (!request) {
    throw new Error('Co-op request not found.');
  }

  request.status = 'failed';
  request.accepted = false;
  request.reason = reason;
  request.updatedAt = new Date().toISOString();

  database.saveCoop(request);

  return request;
}

/*
 * Parse common co-op request messages.
 *
 * This intentionally does not automatically accept every request.
 * The caller must compare the requester against the configured
 * target username first.
 */
function parseRequestMessage(message) {
  if (!message) return null;

  const text = String(message)
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /(.+?)\s+(?:has|sent)\s+(?:sent\s+)?you\s+(?:a\s+)?co-?op\s+request/i,
    /(.+?)\s+invited\s+you\s+to\s+(?:their\s+)?co-?op/i,
    /(.+?)\s+wants\s+to\s+join\s+your\s+co-?op/i,
    /co-?op\s+request\s+from\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) continue;

    const username = normalizeUsername(match[1]);

    if (!username) continue;

    return {
      requester: username,
      raw: text
    };
  }

  return null;
}

function clearOldRequests(botId) {
  const requests = listRequests(botId);

  const cutoff =
    Date.now() - 24 * 60 * 60 * 1000;

  for (const request of requests) {
    const created =
      new Date(request.createdAt).getTime();

    if (
      Number.isFinite(created) &&
      created < cutoff &&
      request.status === 'pending'
    ) {
      request.status = 'expired';
      request.updatedAt =
        new Date().toISOString();

      database.saveCoop(request);
    }
  }
}

module.exports = {
  normalizeUsername,
  sameUsername,

  createRequest,
  getRequest,
  listRequests,
  getPendingRequests,

  isExpectedRequester,
  findExpectedRequest,

  acceptRequest,
  rejectRequest,

  markConfirmed,
  markFailed,

  parseRequestMessage,
  clearOldRequests
};
