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

def finality_telemetry(rpc,scope,genesis,height,read_block=None):
    import re
    # Use the existing fixed telemetry method and its selected-height contract.
    # A current tip is not a commitment to the requested historical block.
    require(type(height) is int and 0<height<2**53,'Invalid finality height')
    value=rpc.call('synergy_chainTelemetry',{'at_height':height})
    observation_identity(value,scope,genesis,rpc.pid)
    require('common_finalized_commitment' in value,'Selected commitment field unavailable')
    commitment=value.get('common_finalized_commitment')
    if commitment is None:
        # The durable compact receipt batch can outlive the full World needed
        # by telemetry. This is still only a node observation until the
        # complete existing witness passes the native three-QC verifier below.
        require(callable(read_block) and type(value.get('finalized_height')) is int
            and height<=value['finalized_height']<2**53,'Selected finalized commitment unavailable')
        block=read_block(height)
        keys={'height','block_hash','parent_block_hash','protected_execution_root','state_root',
              'finality_certificate_id','transactions','receipts','representation','payloads_available'}
        require(isinstance(block,dict) and set(block)==keys and type(block['height']) is int
            and block['height']==height and block['representation']=='compact_public_v1'
            and block['payloads_available'] is False
            and isinstance(block['transactions'],list) and isinstance(block['receipts'],list)
            and len(block['transactions'])==len(block['receipts'])
            and all(isinstance(block[k],str) and re.fullmatch('[a-f0-9]{64}',block[k])
                for k in ('block_hash','parent_block_hash','protected_execution_root','state_root','finality_certificate_id')),
            'Exact compact finalized block unavailable')
        commitment={'height':height,'block_id':block['block_hash'],'state_root':block['state_root'],
            'finality_certificate_id':block['finality_certificate_id'],'protected_execution_root':block['protected_execution_root']}
        value={**value,'common_finalized_commitment':commitment}
    require(isinstance(commitment,dict) and set(commitment)=={'height','block_id','state_root','finality_certificate_id','protected_execution_root'}
        and type(commitment['height']) is int and commitment['height']==height
        and all(isinstance(commitment[k],str) and re.fullmatch('[a-f0-9]{64}',commitment[k])
            for k in ('block_id','state_root','finality_certificate_id','protected_execution_root')),'Selected finalized commitment unavailable')
    return value

def finality_document(fetch,height):
    import base64,hashlib,re,time
    keys={'version','height','kind','encoding','bytes_base64','sha256','total_bytes','offset','next_offset','authentication'}
    data=bytearray();digest=None;total=None;last=None
    for page_number in range(16):
        if last is not None:time.sleep(max(0,0.26-(time.monotonic()-last)))
        params={'height':height,'kind':'finality','offset':len(data),'limit':65536}
        if digest is not None:params['expected_sha256']=digest
        last=time.monotonic();page=fetch(params)
        if page is None and page_number==0:return None
        require(isinstance(page,dict) and set(page)==keys and type(page['version']) is int and page['version']==1
            and type(page['height']) is int and page['height']==height and page['kind']=='finality' and page['encoding']=='base64'
            and type(page['offset']) is int and page['offset']==len(data)
            and isinstance(page['sha256'],str) and re.fullmatch('[a-f0-9]{64}',page['sha256'])
            and type(page['total_bytes']) is int and 0<page['total_bytes']<=1024*1024
            and page['authentication']=='verify complete original bytes against independently authenticated PoSy commitments','Invalid finality page')
        if digest is None:digest=page['sha256'];total=page['total_bytes']
        require(page['sha256']==digest and page['total_bytes']==total,'Finality document changed')
        require(isinstance(page['bytes_base64'],str) and len(page['bytes_base64'])<=87384,'Finality page exceeds bound')
        chunk=base64.b64decode(page['bytes_base64'],validate=True)
        require(base64.b64encode(chunk).decode()==page['bytes_base64'] and len(chunk)==min(65536,total-len(data)),'Invalid finality page bytes')
        data.extend(chunk);expected=len(data) if len(data)<total else None
        require(page['next_offset']==expected and (expected is None or type(page['next_offset']) is int),'Invalid finality continuation')
        if expected is None:
            require(hashlib.sha256(data).hexdigest()==digest,'Finality document digest differs')
            return bytes(data),digest,page_number+1
    raise ValueError('Finality document exceeds bound')

def verify_finality_document(c,root,raw,scope,genesis,commitment):
    import tempfile,signal
    config_path=c.direct(root/'config/node.json',True,1024*1024);config_bytes=config_path.read_bytes();config=json.loads(config_bytes)
    require(config.get('genesis_path')==str(root/'network/genesis.json') and config.get('manifest_path')==str(root/'network/network-manifest.json')
        and config.get('consensus',{}).get('authority_binding')==str(root/'network/authority.json')
        and config.get('consensus',{}).get('authority_trust_key_path')==str(root/'network/authority-root.pub')
        and config.get('storage',{}).get('data_directory')==str(root/'data'),'Finality verifier origin paths differ')
    provider=config.get('aegis_provider',{});report=c.direct(root/'lib/apqe/build-report.json',False,4*1024*1024)
    require(provider.get('report_path')==str(report) and provider.get('authenticated_report_sha256')==hashlib.sha256(report.read_bytes()).hexdigest(),'Finality provider differs')
    tmp=root/'tmp';m=tmp.lstat();require(stat.S_ISDIR(m.st_mode) and not tmp.is_symlink() and m.st_uid==os.geteuid() and not m.st_mode&0o022,'Unsafe proof temporary directory')
    fd,name=tempfile.mkstemp(prefix='consensus-proof-',suffix='.json',dir=tmp);handlers={}
    def cancelled(signum,frame):raise SystemExit('Observation cancelled')
    try:
        for sig in (signal.SIGTERM,signal.SIGHUP):handlers[sig]=signal.signal(sig,cancelled)
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush()
        from synergy_linux import native
        result=json.loads(native([root/'bin/synergy-node','finality-proof','verify',config_path,name],timeout=45,maximum_stdout=16384))
        require(set(result)=={'version','verified','chain_id','network_id','genesis_hash','finalized'} and type(result['version']) is int and result['version']==1
            and result['verified'] is True and type(result['chain_id']) is int and result['chain_id']==int(scope['chain_id'])
            and result['network_id']==scope['network_id'] and result['genesis_hash']==genesis,'Finality verifier scope differs')
        fields={'height','block_id','finality_certificate_id','protected_execution_root'}
        require(isinstance(result['finalized'],dict) and set(result['finalized'])==fields
            and all(result['finalized'][k]==commitment[k] for k in fields)
            and config_path.read_bytes()==config_bytes,'Finality verifier commitment differs')
        return result
    finally:
        try:os.unlink(name)
        finally:
            for sig,handler in handlers.items():signal.signal(sig,handler)

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
        # A retained receipt can outlive its historical World. Explicit null
        # cannot establish account absence; validate every other present view.
        if value is None:continue
        require(isinstance(value,dict) and value.get('address')==selector[role]
            and type(value.get('finalized_height')) is int and value['finalized_height']==selector['height']
            and value.get('finalized_block_hash')==raw['block_hash'] and pin(value.get('state_root'))
            and type(value.get('nonce')) is int and 0<=value['nonce']<2**53
            and isinstance(value.get('balance_nwei'),str) and re.fullmatch('0|[1-9][0-9]{0,38}',value['balance_nwei'])
            and int(value['balance_nwei'])<2**128,'Same-block account observation unavailable')
        views[role]={k:value[k] for k in ('address','balance_nwei','nonce','finalized_height','finalized_block_hash','state_root')}
    if len(views)!=2:return result
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
            method='synergy_getFinalizedProofPageV1' if op=='finality' else 'synergy_getEpochTransitionProofV1'
            # LocalRpc's spending allowlist is deliberately unchanged. These two
            # fixed read methods use the SAME listener/PID checks and envelope.
            deadline=time.monotonic()+30
            def fetch(params,read_method=method):
                require(read_method==method or op=='finality' and read_method=='synergy_getBlock','Unsupported evidence read')
                require(time.monotonic()<deadline,'Evidence deadline exceeded')
                require(listener(root,c.public_json(root/'config/node.json',True))==(rpc.pid,rpc.port),'RPC ownership changed')
                conn=http.client.HTTPConnection('127.0.0.1',rpc.port,timeout=min(10,deadline-time.monotonic()))
                try:
                    conn.request('POST','/rpc',body=json.dumps({'jsonrpc':'2.0','id':1,'method':read_method,'params':params},separators=(',',':')),headers={'Content-Type':'application/json','Connection':'close'})
                    response=conn.getresponse();raw=response.read(4*1024*1024+1)
                    require(response.status==200 and len(raw)<=4*1024*1024,'Evidence response exceeds bound')
                    envelope=json.loads(raw);require(isinstance(envelope,dict) and set(envelope)=={'jsonrpc','id','result'} and envelope['jsonrpc']=='2.0' and type(envelope['id']) is int and envelope['id']==1,'Evidence unavailable')
                    return envelope['result']
                finally:conn.close()
            document=finality_document(fetch,value) if op=='finality' else None
            evidence=fetch({'epoch':value}) if op=='epoch' else None
            if document is not None:
                raw,digest,pages=document
                selected=finality_telemetry(rpc,scope,genesis,value,
                    lambda height:fetch({'height':height,'hash':None},'synergy_getBlock'))
                verified=verify_finality_document(c,root,raw,scope,genesis,selected['common_finalized_commitment'])
                import base64
                evidence={'schema':'nodenetwork-finality-document-v1','height':value,'sha256':digest,'bytes_base64':base64.b64encode(raw).decode(),'pages':pages,'verification':verified}
        after=rpc.verify();observation_identity(after,scope,genesis,rpc.pid)
        if selected is not None:
            require(type(selected.get('finalized_height')) is int and type(after.get('finalized_height')) is int
                and value<=selected['finalized_height']<=after['finalized_height'],'Finalized observation regressed')
        require(c.policy()==policy,'Observation policy changed')
        return {'schema':'nodenetwork-consensus-observation-v1','scope':{'network_id':scope['network_id'],'chain_id':scope['chain_id'],'genesis_hash':genesis,'formation_sha256':scope['formation_sha256'],'manifest_sha256':receipt['package_sha256']},'operation':op,'selector':value,'telemetry':selected if selected is not None else after,'evidence':evidence}
