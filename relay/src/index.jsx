import {useEffect, useRef, useState} from 'react';
import {useNative, relay, Resource, useResource, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import Panel, {PanelHeading} from './Panel.jsx';
import Button from './Button.jsx';
import {decimalToRawAmount, rawAmountIsPositive, rawAmountToDecimal} from './tokenAmount.js';
import {networks, relayHealth, tokenRegistry, indicativeQuote} from './model.js';
import './relay.css';

const percent = bps => `${(bps / 100).toFixed(2)}%`;

export function RelayApp() {
  const native = useNative();
  return native.permit('relay', 'readNetwork')
    ? <RelayReader/>
    : <p>Allow Relay public reads in Security &amp; permissions.</p>;
}

function QuoteDetails({quote, token, expired}) {
  if (expired) {
    return <section><h2>Expired quote</h2><p>Request a new quote to refresh pricing and routing.</p></section>;
  }
  const amount = raw => `${rawAmountToDecimal(raw, token.decimals, token.decimals)} ${token.symbol}`;
  const fee = quote.treasuryFee;
  return <section className="relay-quote">
    <h2>Indicative output</h2>
    <p className="relay-quote-output">{amount(quote.buyAmount)}</p>
    <dl className="relay-quote-details">
      <div><dt>Provider</dt><dd>{quote.provider}</dd></div>
      <div><dt>Reported minimum</dt><dd>{quote.minBuyAmount === null ? 'Unavailable' : amount(quote.minBuyAmount)}</dd></div>
      <div><dt>Relay fee</dt><dd>{fee ? fee.enabled
        ? `${percent(fee.bps)} in the ${fee.tokenMode === 'sellToken' ? 'sell' : 'buy'} token`
        : 'Disabled for this route' : 'Unavailable'}</dd></div>
      <div><dt>Route sources</dt><dd>{quote.sources.length ? <ul>{quote.sources.map(source =>
        <li key={source.name}>{source.name} {percent(source.proportionBps)}</li>,
      )}</ul> : 'Unavailable'}</dd></div>
      <div><dt>Expires</dt><dd><time dateTime={quote.expiresAt}>{quote.expiresAt}</time></dd></div>
    </dl>
    {quote.routeSummary && <p>{quote.routeSummary}</p>}
    <SourceAge source="Relay indicative quote read" updatedAt={quote.receivedAt}/>
    <p>Pricing and route shares are provider estimates. Execution and settlement are unavailable in Portal.</p>
  </section>;
}

export function RelayReader() {
  const [chain, setChain] = useState(1);
  const [sell, setSell] = useState('');
  const [buy, setBuy] = useState('');
  const [amount, setAmount] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [, refreshClock] = useState(0);
  const request = useRef(null);
  const resource = useResource(async signal => {
    const health = relayHealth(await relay('health', {}, {signal}), chain);
    const canQuote = health.status === 'online' && health.chainSupported && health.quotesEnabled;
    const tokens = canQuote ? tokenRegistry(await relay('tokens', {chain_id: chain}, {signal}), chain) : [];
    return {health, tokens, canQuote, receivedAt: Date.now()};
  }, JSON.stringify([chain, revision]));
  const tokens = resource.data?.tokens ?? [];
  const from = tokens.find(token => token.address === sell);
  const to = tokens.find(token => token.address === buy);
  const raw = from ? decimalToRawAmount(amount, from.decimals) : null;
  const key = JSON.stringify([chain, revision, sell, buy, amount]);
  const current = result?.key === key ? result : null;
  const quote = current?.quote;
  const canQuote = Boolean(from && to && sell !== buy && rawAmountIsPositive(raw));

  useEffect(() => {
    setResult(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [key]);
  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => refreshClock(count => count + 1), Math.min(Math.max(0, Date.parse(quote.expiresAt) - Date.now()), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [quote]);

  function reload() {
    setRevision(value => value + 1);
  }

  async function getQuote(event) {
    event.preventDefault();
    if (!canQuote || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setResult({key, pending: true});
    const input = {chain_id: chain, sell_token: sell, buy_token: buy, sell_amount: raw};
    try {
      const value = indicativeQuote(await relay('quote', input, {signal: controller.signal}), input);
      if (!controller.signal.aborted) setResult({key, quote: value});
    } catch (error) {
      if (!controller.signal.aborted) setResult({key, error: error instanceof Error ? error.message : String(error)});
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return <div className="relay-migrated">
    <h1>Relay</h1>
    <p>Indicative same-chain EVM quotes. Pair and amount are sent to Relay when requested.</p>
    <Panel accent>
      <PanelHeading title="Swap quote" eyebrow="Indicative routes"/>
      <label>Network<select value={chain} onChange={event => {
        setChain(Number(event.target.value));
        setSell('');
        setBuy('');
      }}>
        {networks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <Resource value={{...resource, reload}}>{value => <>
        <SourceAge updatedAt={value.receivedAt} source={value.canQuote ? 'Relay public token registry' : 'Relay public service status'}/>
        {value.health.status !== 'online' ? <p>Relay reports its service is {value.health.status}.</p>
          : !value.health.chainSupported ? <p>Relay does not advertise this network.</p>
          : !value.health.quotesEnabled ? <p>Relay reports same-chain quotes are disabled.</p>
          : value.tokens.length < 2 ? <p>The registry supplied fewer than two eligible tokens.</p> : null}
      </>}</Resource>
      <form onSubmit={getQuote}>
        <label>Sell token<select value={sell} disabled={!tokens.length} onChange={event => setSell(event.target.value)}>
          <option value="">Choose token</option>
          {tokens.map(token => <option disabled={token.address === buy} key={token.address} value={token.address}>{token.symbol}</option>)}
        </select></label>
        <Button type="button" className="relay-direction" aria-label="Swap direction" disabled={!from || !to}
          onClick={() => {setSell(buy);setBuy(sell);}}>⇅</Button>
        <label>Buy token<select value={buy} disabled={!tokens.length} onChange={event => setBuy(event.target.value)}>
          <option value="">Choose token</option>
          {tokens.map(token => <option disabled={token.address === sell} key={token.address} value={token.address}>{token.symbol}</option>)}
        </select></label>
        <label>Sell amount<input inputMode="decimal" maxLength={120} value={amount} onChange={event => setAmount(event.target.value)}/></label>
        <Button type="submit" variant="primary" disabled={!canQuote || current?.pending}>Get indicative quote</Button>
      </form>
      {!resource.error && <Button className="relay-reload" disabled={resource.loading} onClick={reload}>Reload service</Button>}
      {current?.pending && <p role="status">Reading indicative quote…</p>}
      <ErrorMessage error={current?.error}/>
      {quote && to && <QuoteDetails quote={quote} token={to} expired={Date.parse(quote.expiresAt) <= Date.now()}/>}
    </Panel>
  </div>;
}
