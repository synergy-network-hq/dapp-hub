import {useNative,atlas,snrg,useResource,ErrorMessage,short} from "@synergy-network/portal-native/dapp-sdk";
export function DappWidget({widgetKey:key}){
 const n=useNative(),account=n.account.data,proposals=n.governance.data?.proposals||[],address=n.wallet.connection?.address;let body=null;
  if(!n.permit('wallet','readWallet'))body=<p>Allow Wallet account access in Security.</p>;
  else if(!address)body=<p>Connect Synergy Wallet to see your account.</p>;
  else if(key==='balance')body=<><strong>{account?snrg(account.walletBalanceNwei):'Loading…'} SNRG</strong><p>{short(address)}</p><ErrorMessage error={n.account.error}/></>;
  else body=<><ErrorMessage error={n.account.error}/>{(account?.recentTransactions||[]).slice(0,3).map(tx=><p key={tx.hash}>{short(tx.hash)} · {tx.status||'indexed'}</p>)}{account&&!account.recentTransactions?.length&&<p>No indexed wallet transactions.</p>}</>;

 return body;
}
