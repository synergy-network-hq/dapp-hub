import unittest,runpy
from pathlib import Path
class ObservationBoundary(unittest.TestCase):
    def setUp(self):
        def require(ok,message):
            if not ok:raise ValueError(message)
        self.m=runpy.run_path(str(Path(__file__).parents[1]/'native/src/consensus_observation.py'),init_globals={'require':require})
    def test_fixed_methods_only(self):
        for op,value in [('telemetry',None),('finality',1),('epoch',2)]:self.m['observation_query']({'operation':op,'value':value})
        for q in [{'operation':'submit','value':None},{'operation':'epoch','value':True},{'operation':'finality','value':0},{'operation':'telemetry','value':None,'url':'http://foreign'}]:
            with self.assertRaises(ValueError):self.m['observation_query'](q)
    def test_foreign_genesis_network_chain_and_wrong_pid(self):
        scope={'network_id':'fresh','chain_id':'99999'};good={'schema_version':1,'network_identity':'fresh','chain_id':99999,'genesis_hash':'a'*64,'process_id':123}
        self.m['observation_identity'](good,scope,'a'*64,123)
        for key,value in [('network_identity','old'),('genesis_hash','b'*64),('chain_id',1266),('process_id',456),('process_id',True)]:
            bad={**good,key:value}
            with self.assertRaises(ValueError):self.m['observation_identity'](bad,scope,'a'*64,123)
    def test_finality_reads_the_exact_height_not_the_advancing_tip(self):
        from copy import deepcopy
        scope={'network_id':'fresh','chain_id':'99999'}
        value={'schema_version':1,'network_identity':'fresh','chain_id':99999,'genesis_hash':'a'*64,
            'process_id':123,'finalized_height':112,'common_finalized_commitment':{'height':100,
                'block_id':'b'*64,'state_root':'c'*64,'finality_certificate_id':'d'*64,'protected_execution_root':'e'*64}}
        calls=[]
        class Rpc:
            pid=123
            def call(self,method,params):
                calls.append((method,params));return deepcopy(value)
        self.assertEqual(self.m['finality_telemetry'](Rpc(),scope,'a'*64,100),value)
        self.assertEqual(calls,[('synergy_chainTelemetry',{'at_height':100})])
        for commitment in (None,{}, {'height':101},{'height':True}):
            value['common_finalized_commitment']=commitment
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100)
        value['common_finalized_commitment']={'height':100};value['process_id']=456
        with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100)
        before=len(calls)
        for height in (0,True,2**53):
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,height)
        self.assertEqual(len(calls),before)
    def test_pruned_telemetry_uses_only_exact_compact_block_and_projects_no_payload(self):
        from copy import deepcopy
        scope={'network_id':'fresh','chain_id':'99999'}
        telemetry={'schema_version':1,'network_identity':'fresh','chain_id':99999,'genesis_hash':'a'*64,
            'process_id':123,'finalized_height':200,'common_finalized_commitment':None}
        block={'height':100,'block_hash':'b'*64,'parent_block_hash':'c'*64,'state_root':'d'*64,
            'finality_certificate_id':'e'*64,'protected_execution_root':'f'*64,'transactions':['SECRET'],
            'receipts':['SECRET'],'representation':'compact_public_v1','payloads_available':False}
        calls=[]
        class Rpc:
            pid=123
            def call(self,method,params):calls.append((method,params));return deepcopy(telemetry)
        def read(height):calls.append(('synergy_getBlock',{'height':height,'hash':None}));return deepcopy(block)
        observed=self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,read)
        self.assertEqual(calls,[('synergy_chainTelemetry',{'at_height':100}),('synergy_getBlock',{'height':100,'hash':None})])
        self.assertEqual(observed['common_finalized_commitment'],{'height':100,'block_id':'b'*64,'state_root':'d'*64,'finality_certificate_id':'e'*64,'protected_execution_root':'f'*64})
        self.assertNotIn('SECRET',str(observed));self.assertIsNone(telemetry['common_finalized_commitment'])
        for key,val in [('height',101),('height',True),('block_hash','bad'),('state_root','bad'),('finality_certificate_id','bad'),('protected_execution_root','bad'),('parent_block_hash','bad'),('representation','full'),('payloads_available',True),('transactions',{}),('receipts',[]),('network_id','foreign')]:
            bad={**block,key:val}
            with self.subTest(key=key),self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,lambda height:bad)
        for missing in ('representation','payloads_available'):
            bad=deepcopy(block);del bad[missing]
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,lambda height:bad)
        for bad in (None,{},False,[]):
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,lambda height:bad)
        def refused(height):raise RuntimeError('Exact block refused')
        with self.assertRaisesRegex(RuntimeError,'Exact block refused'):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,refused)
        for key,val in [('network_identity','foreign'),('chain_id',1266),('genesis_hash','f'*64),('process_id',456)]:
            original=deepcopy(telemetry);telemetry[key]=val;calls.clear()
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,read)
            self.assertEqual(len(calls),1);telemetry.clear();telemetry.update(original)
        for commitment in ({},{'height':101}):
            telemetry['common_finalized_commitment']=commitment;calls.clear()
            with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,read)
            self.assertEqual(len(calls),1)
        del telemetry['common_finalized_commitment'];calls.clear()
        with self.assertRaises(ValueError):self.m['finality_telemetry'](Rpc(),scope,'a'*64,100,read)
        self.assertEqual(len(calls),1)
    def test_fixed_block_fetch_keeps_owned_listener_envelope_and_method_boundary(self):
        import ast,copy,json,types
        source=Path(__file__).parents[1]/'native/src/consensus_observation.py'
        fetch=next(node for node in ast.walk(ast.parse(source.read_text())) if isinstance(node,ast.FunctionDef) and node.name=='fetch')
        requests=[];body={'jsonrpc':'2.0','id':1,'result':None}
        class Response:
            status=200
            def read(self,limit):
                self_limit=4*1024*1024+1
                if limit!=self_limit:raise AssertionError('Read bound changed')
                return json.dumps(body).encode()
        class Connection:
            def __init__(self,host,port,timeout):
                if (host,port,timeout)!=('127.0.0.1',1234,10):raise AssertionError('RPC endpoint changed')
            def request(self,verb,path,**kwargs):requests.append((verb,path,json.loads(kwargs['body'])))
            def getresponse(self):return Response()
            def close(self):pass
        namespace={'require':self.m['finality_telemetry'].__globals__['require'],'op':'finality',
            'method':'synergy_getFinalizedProofPageV1','deadline':30,'time':types.SimpleNamespace(monotonic=lambda:0),
            'root':Path('/fixture'),'c':types.SimpleNamespace(public_json=lambda *args:{}),
            'rpc':types.SimpleNamespace(pid=123,port=1234),'listener':lambda *args:(123,1234),
            'http':types.SimpleNamespace(client=types.SimpleNamespace(HTTPConnection=Connection)),'json':json}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[copy.deepcopy(fetch)],type_ignores=[])),'<fixed-observation-fetch>','exec'),namespace)
        call=namespace['fetch'];params={'height':100,'hash':None}
        self.assertIsNone(call(params,'synergy_getBlock'))
        self.assertEqual(requests,[('POST','/rpc',{'jsonrpc':'2.0','id':1,'method':'synergy_getBlock','params':params})])
        for method in ('synergy_submitProcessingTransactionV1','arbitrary', 'synergy_getAccount'):
            with self.assertRaises(ValueError):call(params,method)
        self.assertEqual(len(requests),1)
        namespace['listener']=lambda *args:(456,1234)
        with self.assertRaises(ValueError):call(params,'synergy_getBlock')
        self.assertEqual(len(requests),1);namespace['listener']=lambda *args:(123,1234)
        body.clear();body.update({'jsonrpc':'2.0','id':1,'error':{'message':'SECRET'}})
        with self.assertRaisesRegex(ValueError,'Evidence unavailable'):call(params,'synergy_getBlock')
class TransactionObservation(unittest.TestCase):
    def setUp(self):
        def require(ok,message):
            if not ok:raise ValueError(message)
        self.m=runpy.run_path(str(Path(__file__).parents[1]/'native/src/consensus_observation.py'),init_globals={'require':require})
        self.selector={'transaction_id':'a'*64,'sender':'syna1'+'a'*35,'receiver':'syna1'+'b'*35,'height':1661}
        self.tx={'transaction_id':'a'*64,'block_height':1661,'block_hash':'b'*64,'finality_certificate_id':'c'*64,'status':'applied','transaction':{'unsigned':{'sender':self.selector['sender'],'receiver':self.selector['receiver'],'payload':'SECRET'}},'receipt':{'private':'SECRET'}}
        self.accounts={role:{'address':self.selector[role],'balance_nwei':balance,'nonce':nonce,'finalized_height':1661,'finalized_block_hash':'b'*64,'state_root':'d'*64,'extra':'SECRET'} for role,balance,nonce in [('sender','4999998999160000',1),('receiver','1000000000',0)]}
    def observe(self,tx=None,accounts=None,use_null=False):
        from copy import deepcopy
        calls=[];outer=self
        class Rpc:
            def call(self,method,params):
                calls.append((method,params))
                if method=='synergy_getTransaction':return None if use_null else deepcopy(outer.tx if tx is None else tx)
                if method=='synergy_getAccount':
                    role=next(k for k in ('sender','receiver') if outer.selector[k]==params['address'])
                    return deepcopy((outer.accounts if accounts is None else accounts)[role])
                raise AssertionError('Unexpected RPC')
        return self.m['transaction_observation'](Rpc(),self.selector),calls
    def test_applied_exact_three_reads_projection(self):
        import json
        self.m['observation_query']({'operation':'transaction','value':self.selector})
        value,calls=self.observe()
        self.assertEqual([m for m,_ in calls],['synergy_getTransaction','synergy_getAccount','synergy_getAccount'])
        self.assertEqual(calls[1][1],{'address':self.selector['sender'],'at_height':1661})
        self.assertEqual(set(value),{'schema','transaction','accounts'})
        self.assertEqual(value['accounts']['sender']['nonce'],1)
        self.assertNotIn('SECRET',json.dumps(value))
        self.assertEqual(set(value['transaction']),{'transaction_id','block_height','block_hash','finality_certificate_id','status'})
    def test_null_reverted_and_unavailable_never_fabricate_accounts(self):
        value,calls=self.observe(use_null=True);self.assertIsNone(value['transaction']);self.assertIsNone(value['accounts']);self.assertEqual(len(calls),1)
        value,calls=self.observe(tx={**self.tx,'status':'reverted'});self.assertIsNone(value['accounts']);self.assertEqual(len(calls),1)
        value,calls=self.observe(accounts={'sender':None,'receiver':None})
        self.assertEqual(value['transaction']['transaction_id'],self.selector['transaction_id'])
        self.assertIsNone(value['accounts']);self.assertEqual(len(calls),3)
    def test_null_historical_account_retains_receipt_but_never_masks_malformed_other(self):
        from copy import deepcopy
        for missing,present in [('sender','receiver'),('receiver','sender')]:
            accounts=deepcopy(self.accounts);accounts[missing]=None
            value,calls=self.observe(accounts=accounts)
            self.assertIsNone(value['accounts']);self.assertEqual(value['transaction']['status'],'applied');self.assertEqual(len(calls),3)
            for key,val in [('address','syna1foreignaccount'),('finalized_height',1662),('finalized_block_hash','f'*64),('state_root','bad'),('balance_nwei','01'),('nonce',True)]:
                bad=deepcopy(accounts);bad[present][key]=val
                with self.subTest(missing=missing,key=key),self.assertRaises(ValueError):self.observe(accounts=bad)
        for malformed in ({},[],False,0,'unavailable'):
            with self.subTest(malformed=malformed),self.assertRaises(ValueError):self.observe(accounts={'sender':None,'receiver':malformed})
    def test_account_rpc_failure_is_not_treated_as_explicit_null(self):
        outer=self
        class Rpc:
            def call(self,method,params):
                if method=='synergy_getTransaction':return outer.tx
                if params['address']==outer.selector['sender']:return None
                raise RuntimeError('RPC refused the second account read')
        with self.assertRaisesRegex(RuntimeError,'second account read'):
            self.m['transaction_observation'](Rpc(),self.selector)
    def test_selector_closed_and_bounded(self):
        for key,val in [('height',True),('height',0),('height',2**53),('transaction_id','A'*64),('sender','http://foreign'),('extra',1)]:
            with self.subTest(key=key),self.assertRaises(ValueError):self.m['observation_query']({'operation':'transaction','value':{**self.selector,key:val}})
    def test_foreign_receipt_or_participants_refuse(self):
        from copy import deepcopy
        for key,val in [('transaction_id','f'*64),('block_height',1662),('block_height',True),('block_hash','bad'),('finality_certificate_id','bad'),('status','pending')]:
            with self.subTest(key=key),self.assertRaises(ValueError):self.observe(tx={**self.tx,key:val})
        bad=deepcopy(self.tx);bad['transaction']['unsigned']['sender']=self.selector['receiver']
        with self.assertRaises(ValueError):self.observe(tx=bad)
        for unsigned in (None,{},'bad'):
            with self.assertRaises(ValueError):self.observe(tx={**self.tx,'transaction':{'unsigned':unsigned}})
    def test_account_context_canonical_numbers_and_roots(self):
        from copy import deepcopy
        for key,val in [('address',self.selector['receiver']),('finalized_height',1662),('finalized_height',True),('finalized_block_hash','f'*64),('state_root','f'*64),('balance_nwei','01'),('balance_nwei',str(2**128)),('nonce',True),('nonce',2**53)]:
            bad=deepcopy(self.accounts);bad['sender'][key]=val
            with self.subTest(key=key),self.assertRaises(ValueError):self.observe(accounts=bad)

class FinalityContinuation(unittest.TestCase):
    def setUp(self):
        import hashlib,base64
        self.hashlib=hashlib;self.base64=base64
        def require(ok,message):
            if not ok:raise ValueError(message)
        self.m=runpy.run_path(str(Path(__file__).parents[1]/'native/src/consensus_observation.py'),init_globals={'require':require})
        self.raw=b'public canonical finality bytes'*3000;self.digest=hashlib.sha256(self.raw).hexdigest()
    def page(self,q):
        end=min(len(self.raw),q['offset']+q['limit'])
        return {'version':1,'height':100,'kind':'finality','encoding':'base64','sha256':self.digest,'total_bytes':len(self.raw),'offset':q['offset'],'next_offset':end if end<len(self.raw) else None,'bytes_base64':self.base64.b64encode(self.raw[q['offset']:end]).decode(),'authentication':'verify complete original bytes against independently authenticated PoSy commitments'}
    def test_two_pages_pinned_digest_exact_offsets_and_bounded_pacing(self):
        from unittest.mock import patch
        calls=[]
        def fetch(q):calls.append(q);return self.page(q)
        with patch('time.sleep') as sleep:
            self.assertEqual(self.m['finality_document'](fetch,100),(self.raw,self.digest,2))
        self.assertEqual(calls,[{'height':100,'kind':'finality','offset':0,'limit':65536},{'height':100,'kind':'finality','offset':65536,'limit':65536,'expected_sha256':self.digest}]);sleep.assert_called_once()
    def test_changed_or_truncated_or_foreign_page_never_verifies(self):
        from unittest.mock import patch
        changes=[('sha256','f'*64),('height',101),('total_bytes',len(self.raw)+1),('offset',0),('next_offset',True),('authentication','trust this key'),('bytes_base64','eA==')]
        for key,value in changes:
            def fetch(q):
                result=self.page(q)
                if q['offset']:result[key]=value
                return result
            with self.subTest(key=key),patch('time.sleep'),self.assertRaises(ValueError):self.m['finality_document'](fetch,100)
        self.assertIsNone(self.m['finality_document'](lambda q:None,100))
        with self.assertRaises(ValueError):self.m['finality_document'](lambda q:{**self.page(q),'total_bytes':1024*1024+1},100)
    def test_owner_scope_commitment_and_temporary_cleanup_on_failure_or_cancel(self):
        import tempfile,json,os,stat,types,sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'tmp').mkdir(mode=0o700);(root/'config').mkdir();(root/'lib/apqe').mkdir(parents=True)
            report=root/'lib/apqe/build-report.json';report.write_bytes(b'approved provider')
            config={'genesis_path':str(root/'network/genesis.json'),'manifest_path':str(root/'network/network-manifest.json'),
                'consensus':{'authority_binding':str(root/'network/authority.json'),'authority_trust_key_path':str(root/'network/authority-root.pub')},
                'storage':{'data_directory':str(root/'data')},'aegis_provider':{'report_path':str(report),'authenticated_report_sha256':self.hashlib.sha256(report.read_bytes()).hexdigest()}}
            path=root/'config/node.json';path.write_text(json.dumps(config));path.chmod(0o600)
            c=types.SimpleNamespace(direct=lambda p,*args:p)
            scope={'network_id':'fresh','chain_id':'99999'};commit={'height':100,'block_id':'b'*64,'finality_certificate_id':'c'*64,'protected_execution_root':'d'*64}
            result={'version':1,'verified':True,'chain_id':99999,'network_id':'fresh','genesis_hash':'a'*64,'finalized':commit}
            self.m['verify_finality_document'].__globals__.update({'os':os,'stat':stat,'json':json,'hashlib':self.hashlib})
            outcomes=[result,{**result,'verified':False},{**result,'genesis_hash':'f'*64},{**result,'finalized':{**commit,'height':101}},{**result,'finalized':{**commit,'protected_execution_root':'f'*64}},TimeoutError(),SystemExit()]
            for outcome in outcomes:
                def native(argv,**kwargs):
                    proof=Path(argv[-1]);self.assertEqual(proof.parent,root/'tmp');self.assertEqual(stat.S_IMODE(proof.stat().st_mode),0o600);self.assertEqual(proof.read_bytes(),self.raw)
                    self.assertEqual(argv[:3],[root/'bin/synergy-node','finality-proof','verify'])
                    if isinstance(outcome,BaseException):raise outcome
                    return json.dumps(outcome).encode()
                with patch.dict(sys.modules,{'synergy_linux':types.SimpleNamespace(native=native)}):
                    if outcome is result:self.assertEqual(self.m['verify_finality_document'](c,root,self.raw,scope,'a'*64,commit),result)
                    else:
                        with self.assertRaises((ValueError,TimeoutError,SystemExit)):self.m['verify_finality_document'](c,root,self.raw,scope,'a'*64,commit)
                self.assertEqual(list((root/'tmp').iterdir()),[])
            config['storage']['data_directory']='/foreign';path.write_text(json.dumps(config))
            with self.assertRaises(ValueError):self.m['verify_finality_document'](c,root,self.raw,scope,'a'*64,commit)
            config['storage']['data_directory']=str(root/'data');config['aegis_provider']['authenticated_report_sha256']='f'*64;path.write_text(json.dumps(config))
            with self.assertRaises(ValueError):self.m['verify_finality_document'](c,root,self.raw,scope,'a'*64,commit)
            config['aegis_provider']['authenticated_report_sha256']=self.hashlib.sha256(report.read_bytes()).hexdigest();path.write_text(json.dumps(config))
            def changed_config(*args,**kwargs):
                path.write_text('{}');return json.dumps(result).encode()
            with patch.dict(sys.modules,{'synergy_linux':types.SimpleNamespace(native=changed_config)}),self.assertRaises(ValueError):self.m['verify_finality_document'](c,root,self.raw,scope,'a'*64,commit)
            self.assertEqual(list((root/'tmp').iterdir()),[])

if __name__=='__main__':unittest.main()
