const object = value => value && typeof value === 'object' && !Array.isArray(value);
const address = value => typeof value === 'string' && /^0x[a-f0-9]{40}$/i.test(value);
const raw = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
const basisPoints = value => Number.isInteger(value) && value >= 0 && value <= 10000;
const text = (value, limit) => typeof value === 'string' && value.length <= limit &&
  !/[\p{Cc}\p{Cf}]/u.test(value) ? value.trim() : '';

export const networks = [[1, 'Ethereum'], [42161, 'Arbitrum'], [8453, 'Base'], [10, 'Optimism'], [137, 'Polygon'], [43114, 'Avalanche']];

export function relayHealth(value, chain) {
  if (!object(value) || value.mode !== 'aggregator' || !['online', 'degraded', 'offline'].includes(value.status) ||
      !Array.isArray(value.supportedChainIds) || value.supportedChainIds.length > 64 ||
      value.supportedChainIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      typeof value.features?.sameChainSwaps !== 'boolean') {
    throw Error('Relay service status is unsupported.');
  }
  return {
    status: value.status,
    chainSupported: value.supportedChainIds.includes(chain),
    quotesEnabled: value.features.sameChainSwaps,
  };
}

export function tokenRegistry(value, chain) {
  if (!object(value) || value.chainId !== chain || !Array.isArray(value.tokens) || value.tokens.length > 5000 ||
      value.tokens.some(token => !object(token) || !address(token.address) || !text(token.symbol, 32) ||
        !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36 ||
        (token.swapEnabled !== undefined && typeof token.swapEnabled !== 'boolean')) ||
      new Set(value.tokens.map(token => token.address.toLowerCase())).size !== value.tokens.length) {
    throw Error('Relay token registry is unsupported or mismatched.');
  }
  return value.tokens.filter(token => token.swapEnabled !== false)
    .map(({address, symbol, decimals}) => ({address, symbol: symbol.trim(), decimals}));
}

function routeSources(sources) {
  if (!Array.isArray(sources) || sources.length > 32) return [];
  const rows = sources.map(source => ({
    name: text(source?.name, 64),
    proportionBps: source?.proportionBps,
  }));
  if (rows.some(row => !row.name || !basisPoints(row.proportionBps)) ||
      new Set(rows.map(row => row.name)).size !== rows.length) return [];
  return rows;
}

function treasuryFee(treasury) {
  if (treasury?.enabled === false && treasury.bps === 0) return {enabled: false};
  if (treasury?.enabled !== true || !basisPoints(treasury.bps) ||
      !['sellToken', 'buyToken'].includes(treasury.tokenMode)) return null;
  return {enabled: true, bps: treasury.bps, tokenMode: treasury.tokenMode};
}

export function indicativeQuote(value, input) {
  const receivedAt = Date.now();
  const expiry = typeof value?.expiresAt === 'string' && value.expiresAt.length <= 64 ? Date.parse(value.expiresAt) : NaN;
  if (!object(value) || value.mode !== 'indicative' || value.sellChainId !== input.chain_id ||
      value.buyChainId !== input.chain_id || !address(value.sellToken?.address) || !address(value.buyToken?.address) ||
      value.sellToken.address.toLowerCase() !== input.sell_token.toLowerCase() ||
      value.buyToken.address.toLowerCase() !== input.buy_token.toLowerCase() ||
      value.sellAmount !== input.sell_amount || !raw(value.buyAmount) || value.buyAmount === '0' ||
      value.liquidityAvailable === false || !Number.isFinite(expiry) || expiry <= receivedAt) {
    throw Error('Relay quote is expired, unavailable, unsupported or mismatched.');
  }
  const minimum = value.minBuyAmount;
  return {
    buyAmount: value.buyAmount,
    minBuyAmount: raw(minimum) && BigInt(minimum) <= BigInt(value.buyAmount) ? minimum : null,
    expiresAt: value.expiresAt,
    receivedAt,
    provider: text(value.provider, 32) || 'Unspecified',
    routeSummary: text(value.route?.summary, 240),
    sources: routeSources(value.route?.sources),
    treasuryFee: treasuryFee(value.fees?.treasury),
  };
}
