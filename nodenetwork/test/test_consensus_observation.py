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
            'process_id':123,'finalized_height':112,'common_finalized_commitment':{'height':100}}
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
        with self.assertRaises(ValueError):self.observe(accounts={'sender':None,'receiver':None})
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

if __name__=='__main__':unittest.main()
