# Executed only after the native-embedded bootstrap definitions (not its main).
# Fixed public reads; no controller dispatch, grants, custody or state writes.
def observation_query(query):
    require(isinstance(query,dict) and set(query)=={'operation','value'},'Exact observation query required')
    op=query['operation'];value=query['value']
    require(op in ('telemetry','finality','epoch','transaction'),'Unsupported observation')
    if op=='transaction':
        import re
        require(isinstance(value,dict) and set(value)=={'transaction_id','sender','receiver','height'}
            and isinstance(value['transaction_id'],str) and re.fullmatch('[a-f0-9]{64}',value['transaction_id'])
            and type(value['height']) is int and 0<value['height']<2**53
            and all(isinstance(value[k],str) and re.fullmatch('syna1[a-z0-9]{10,123}',value[k]) for k in ('sender','receiver')),'Invalid transaction selector')
    else:require(value is None if op=='telemetry' else type(value) is int and 0<value<2**53,'Invalid observation selector')
    return op,value

def observation_identity(value,scope,genesis,pid):
    require(isinstance(value,dict) and value.get('schema_version')==1 and value.get('network_identity')==scope['network_id']
        and type(value.get('chain_id')) is int and value['chain_id']==int(scope['chain_id'])
        and value.get('genesis_hash')==genesis and type(value.get('process_id')) is int and value['process_id']==pid,'RPC identity differs')

def finality_telemetry(rpc,scope,genesis,height):
    # Use the existing fixed telemetry method and its selected-height contract.
    # A current tip is not a commitment to the requested historical block.
    require(type(height) is int and 0<height<2**53,'Invalid finality height')
    value=rpc.call('synergy_chainTelemetry',{'at_height':height})
    observation_identity(value,scope,genesis,rpc.pid)
    commitment=value.get('common_finalized_commitment')
    require(isinstance(commitment,dict) and type(commitment.get('height')) is int
        and commitment['height']==height,'Selected finalized commitment unavailable')
    return value

def transaction_observation(rpc,selector):
    import re
    pin=lambda v:isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v)
    raw=rpc.call('synergy_getTransaction',{'transaction_id':selector['transaction_id']})
    result={'schema':'nodenetwork-transaction-observation-v1','transaction':None,'accounts':None}
    if raw is None:return result # Not observed by this node, never proof of absence.
    require(isinstance(raw,dict) and raw.get('transaction_id')==selector['transaction_id']
        and type(raw.get('block_height')) is int and raw['block_height']==selector['height']
        and pin(raw.get('block_hash')) and pin(raw.get('finality_certificate_id'))
        and raw.get('status') in ('applied','reverted'),'Transaction observation differs')
    # Check public participant fields when exposed; encrypted payloads are never
    # interpreted or returned. Selected accounts alone are not a participation proof.
    transaction=raw.get('transaction')
    unsigned=transaction.get('unsigned') if isinstance(transaction,dict) else None
    if isinstance(transaction,dict) and 'unsigned' in transaction:
        require(isinstance(unsigned,dict) and all(unsigned.get(k)==selector[k] for k in ('sender','receiver')),'Transaction participant differs')
    for public in (raw,transaction,unsigned,raw.get('receipt')):
        if isinstance(public,dict):
            for field,role in (('sender','sender'),('from','sender'),('receiver','receiver'),('to','receiver')):
                if field in public:require(public[field]==selector[role],'Transaction participant differs')
    result['transaction']={k:raw[k] for k in ('transaction_id','block_height','block_hash','finality_certificate_id','status')}
    if raw['status']!='applied':return result
    views={}
    for role in ('sender','receiver'):
        value=rpc.call('synergy_getAccount',{'address':selector[role],'at_height':selector['height']})
        require(isinstance(value,dict) and value.get('address')==selector[role]
            and type(value.get('finalized_height')) is int and value['finalized_height']==selector['height']
            and value.get('finalized_block_hash')==raw['block_hash'] and pin(value.get('state_root'))
            and type(value.get('nonce')) is int and 0<=value['nonce']<2**53
            and isinstance(value.get('balance_nwei'),str) and re.fullmatch('0|[1-9][0-9]{0,38}',value['balance_nwei'])
            and int(value['balance_nwei'])<2**128,'Same-block account observation unavailable')
        views[role]={k:value[k] for k in ('address','balance_nwei','nonce','finalized_height','finalized_block_hash','state_root')}
    require(views['sender']['state_root']==views['receiver']['state_root'],'Account state roots differ')
    result['accounts']=views
    return result

def consensus_observation(wire):
    import time,http.client
    require(isinstance(wire,dict) and set(wire)=={'context','query'},'Exact observation input required')
    context=wire['context'];op,value=observation_query(wire['query'])
    require(set(context)=={'initial_sha256','parent_sha256','formation_sha256','target','selection','expires_at'}
        and type(context['expires_at']) is int and int(time.time())<=context['expires_at']<=int(time.time())+300,'Observation expired')
    root=ROOT;control=root/'tmp/controller'
    for ancestor in (control,*control.parents):
        m=ancestor.lstat();require(stat.S_ISDIR(m.st_mode) and not ancestor.is_symlink() and m.st_uid==os.geteuid() and not m.st_mode&0o022,'Unsafe observation ancestry')
    path=control/'policy.json';m=path.lstat()
    require(stat.S_ISREG(m.st_mode) and m.st_nlink==1 and m.st_uid==os.geteuid() and stat.S_IMODE(m.st_mode)==0o600 and m.st_size<=1024*1024,'Unsafe observation policy')
    policy=json.loads(path.read_bytes())
    require(policy.get('engineering_initial_authorization_sha256')==context['initial_sha256']
        and policy.get('engineering_authorization',{}).get('sha256')==context['parent_sha256']
        and policy.get('engineering_target')==context['target'] and policy.get('validator_formation_sha256')==context['formation_sha256'],'Observation scope changed')
    for name in enrolled_engine(policy):
        p=control/name if name=='controller.py' else control/'tools'/name;m=p.lstat()
        require(p.resolve()==p and stat.S_ISREG(m.st_mode) and m.st_nlink==1 and m.st_uid==os.geteuid() and not m.st_mode&0o022 and m.st_size<=1024*1024
            and hashlib.sha256(p.read_bytes()).hexdigest()==policy['engine_files'][name],'Observation engine drift')
    require('treasury_send.py' in policy['engine_files'],'Installed RPC verifier unavailable')
    sys.path[:0]=[str(control),str(control/'tools')]
    from controller import Controller,control_inventory,engineering_effective_selection
    import lifecycle as life
    from treasury_send import LocalRpc,listener
    with life._lifecycle_lock(root):
        c=Controller(root);control_inventory(root);receipt,_=life._sealed_receipt(root)
        require(engineering_effective_selection(root,policy)==context['selection'] and receipt['package_sha256']==context['selection']['manifest_sha256'],'Installed selection changed')
        scope,_=c.formation_context();require(scope['formation_sha256']==context['formation_sha256'],'Formation changed')
        pins=c.genesis_pins()
        for name,pin in pins.items():
            require(hashlib.sha256(c.direct(root/'network'/name,True,4*1024*1024).read_bytes()).hexdigest()==pin,'Approved signed Genesis changed')
        genesis=c.public_json(root/'network/genesis.json',True)['genesis_hash']
        require(isinstance(genesis,str) and re.fullmatch('[a-f0-9]{64}',genesis),'Logical Genesis required')
        rpc=LocalRpc(c,scope,genesis);telemetry=rpc.verify();observation_identity(telemetry,scope,genesis,rpc.pid)
        evidence=None;selected=None
        if op=='transaction':
            evidence=transaction_observation(rpc,value)
        elif op!='telemetry':
            method,params=('synergy_getFinalizedProofPageV1',{'height':value,'kind':'finality','offset':0,'limit':65536}) if op=='finality' else ('synergy_getEpochTransitionProofV1',{'epoch':value})
            # LocalRpc's spending allowlist is deliberately unchanged. These two
            # fixed read methods use the SAME listener/PID checks and envelope.
            require(listener(root,c.public_json(root/'config/node.json',True))==(rpc.pid,rpc.port),'RPC ownership changed')
            conn=http.client.HTTPConnection('127.0.0.1',rpc.port,timeout=10)
            try:
                conn.request('POST','/rpc',body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params},separators=(',',':')),headers={'Content-Type':'application/json','Connection':'close'})
                response=conn.getresponse();raw=response.read(4*1024*1024+1)
                require(response.status==200 and len(raw)<=4*1024*1024,'Evidence response exceeds bound')
                envelope=json.loads(raw);require(isinstance(envelope,dict) and set(envelope)=={'jsonrpc','id','result'} and envelope['jsonrpc']=='2.0' and type(envelope['id']) is int and envelope['id']==1,'Evidence unavailable')
                evidence=envelope['result']
            finally:conn.close()
            if op=='finality' and evidence is not None:
                selected=finality_telemetry(rpc,scope,genesis,value)
        after=rpc.verify();observation_identity(after,scope,genesis,rpc.pid)
        if selected is not None:
            require(type(selected.get('finalized_height')) is int and type(after.get('finalized_height')) is int
                and value<=selected['finalized_height']<=after['finalized_height'],'Finalized observation regressed')
        require(c.policy()==policy,'Observation policy changed')
        return {'schema':'nodenetwork-consensus-observation-v1','scope':{'network_id':scope['network_id'],'chain_id':scope['chain_id'],'genesis_hash':genesis,'formation_sha256':scope['formation_sha256'],'manifest_sha256':receipt['package_sha256']},'operation':op,'selector':value,'telemetry':selected if selected is not None else after,'evidence':evidence}
