#!/usr/bin/env python3
"""Validate inert dApp metadata only; never import or execute submitted app code."""
import argparse, base64, json, pathlib, re, sys, tempfile, unittest
from urllib.parse import urlsplit

REPOSITORY='https://github.com/synergy-network-hq/dapp-hub'
CAPABILITIES={'readNetwork','readWallet','requestTransactions','externalLinks'}

def require(ok,message):
    if not ok: raise ValueError(message)

def load(path):
    require(path.is_file() and not path.is_symlink(),f'Not a regular metadata file: {path.name}')
    require(path.stat().st_size<=262144,'Metadata exceeds size limit')
    def unique(pairs):
        result={}
        for key,value in pairs:
            require(key not in result,f'Duplicate JSON key: {key}')
            result[key]=value
        return result
    return json.loads(path.read_text(encoding='utf8'),object_pairs_hook=unique)

def release(value):
    if value is None:return
    require(isinstance(value,dict) and set(value)=={'version','artifact','capabilities','signature','qualification'},'Invalid release fields')
    version=value['version'];require(isinstance(version,str) and re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?',version),'Invalid semantic release version')
    artifact=value['artifact'];require(isinstance(artifact,dict) and set(artifact)=={'url','sha256','bytes'},'Invalid artifact fields')
    url=artifact['url'];parsed=urlsplit(url)
    require(url==f'{REPOSITORY}/releases/download/v{version}/'+parsed.path.rsplit('/',1)[-1] and parsed.scheme=='https' and parsed.netloc=='github.com' and not parsed.query and not parsed.fragment and re.fullmatch(r'[-a-zA-Z0-9_.]+',parsed.path.rsplit('/',1)[-1]),'Artifact must use official versioned HTTPS release URL')
    require(re.fullmatch('[a-f0-9]{64}',artifact['sha256']) and type(artifact['bytes']) is int and 0<artifact['bytes']<=268435456,'Invalid artifact digest/size')
    caps=value['capabilities'];require(isinstance(caps,list) and len(caps)==len(set(caps)) and set(caps)<=CAPABILITIES,'Unknown or duplicate capability')
    sig=value['signature'];require(isinstance(sig,dict) and set(sig)=={'algorithm','provider','keyId','value'},'Invalid release signature fields')
    require(sig['algorithm']=='ML-DSA-87' and sig['provider']=='APQE','Native releases require APQE ML-DSA-87; classical signatures are prohibited')
    require(isinstance(sig['keyId'],str) and re.fullmatch('[a-zA-Z0-9._:-]{1,128}',sig['keyId']),'Invalid authority key identifier')
    require(len(base64.b64decode(sig['value'],validate=True))==4627,'Invalid ML-DSA-87 signature encoding/size')
    q=value['qualification'];require(isinstance(q,dict) and set(q)=={'profile','reportSha256'} and isinstance(q['profile'],str) and 0<len(q['profile'])<=128 and re.fullmatch('[a-f0-9]{64}',q['reportSha256']),'Invalid qualification evidence reference')

def catalog(root):
    apps=[];seen=set()
    for candidate in sorted(root.iterdir(),key=lambda path:path.name):
        if candidate.name in ('node_modules','registry','shared') or candidate.name.startswith('.'):continue
        require(not candidate.is_symlink(),'Application roots cannot be symlinks')
        if not candidate.is_dir() or not (candidate/'manifest.json').exists():continue
        directory=candidate.name;value=load(candidate/'manifest.json');identifier=value.get('id')
        require(isinstance(identifier,str) and re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*',identifier) and len(identifier)<=64,'Invalid application ID')
        require(identifier not in ('quest','prism','nodenetwork'),'Retired or reserved application ID')
        require(identifier not in seen,'Duplicate application ID');seen.add(identifier)
        require(directory==('nodenetwork' if identifier=='node' else identifier),'Application directory must match its ID')
        require(value.get('schemaVersion')==1 and value.get('id')==identifier and value.get('sourceDirectory')==directory,'App identity/path mismatch')
        require(value.get('implementationStatus') in ('bundled','planned'),'Invalid implementation status')
        require(value.get('status') in ('available','coming-soon'),'Invalid discovery status')
        require(isinstance(value.get('name'),str) and value['name'],'Missing app name')
        if value['implementationStatus']=='planned':require(value.get('manifest') is None and value['status']=='coming-soon' and value.get('release') is None,'Planned apps cannot claim implemented/installable releases')
        if value.get('manifest'):
            manifest=value['manifest'];require(manifest.get('id')==identifier and manifest.get('runtime')=='portal-bundled','Bundled manifest identity/runtime mismatch')
            caps=manifest.get('capabilities',[]);require(isinstance(caps,list) and len(caps)==len(set(caps)) and set(caps)<=CAPABILITIES,'Unknown or duplicate bundled capability')
            widgets=manifest.get('widgets',[]);require(len({w['key'] for w in widgets})==len(widgets),'Duplicate widget key')
        require('release' in value,'Missing explicit release gate');release(value['release']);apps.append(value)
    return {'schemaVersion':1,'repository':REPOSITORY,'apps':apps}

class PolicyTests(unittest.TestCase):
    registry_root=pathlib.Path(__file__).resolve().parent.parent
    def test_existing_registry_baseline(self):
        expected={'wallet','atlas','relay','keystone','spark','horizon','vault','learn','node','synq-playground','forge-projects','deployments','network-tools','logs','diagnostics','security-center','identity'}
        self.assertTrue(expected <= {app['id'] for app in catalog(self.registry_root)['apps']})
    def test_new_community_id_and_safe_root_discovery(self):
        with tempfile.TemporaryDirectory(prefix='dapp-metadata-') as temporary:
            root=pathlib.Path(temporary);directory=root/'community-weather';directory.mkdir()
            value={'schemaVersion':1,'id':'community-weather','name':'Community Weather','sourceDirectory':'community-weather','implementationStatus':'planned','status':'coming-soon','release':None}
            def write(): (directory/'manifest.json').write_text(json.dumps(value))
            write();self.assertEqual(catalog(root)['apps'][0]['id'],'community-weather')
            for invalid in ('../escape','quest','prism','nodenetwork'):
                value['id']=invalid;write()
                with self.assertRaises(ValueError):catalog(root)
            value['id']='community-weather';value['sourceDirectory']='../escape';write()
            with self.assertRaises(ValueError):catalog(root)
            value['sourceDirectory']='community-weather';value['implementationStatus']='bundled';value['manifest']={'id':'community-weather','runtime':'portal-bundled','capabilities':['shell']};write()
            with self.assertRaises(ValueError):catalog(root)
            value['implementationStatus']='planned';value.pop('manifest');write()
            (root/'linked-app').symlink_to(directory,target_is_directory=True)
            with self.assertRaises(ValueError):catalog(root)
    def test_node_identity_directory_binding(self):
        with tempfile.TemporaryDirectory(prefix='dapp-node-metadata-') as temporary:
            root=pathlib.Path(temporary);directory=root/'nodenetwork';directory.mkdir()
            value={'schemaVersion':1,'id':'node','name':'NodeNetwork','sourceDirectory':'nodenetwork','implementationStatus':'planned','status':'coming-soon','release':None}
            (directory/'manifest.json').write_text(json.dumps(value));self.assertEqual(catalog(root)['apps'][0]['id'],'node')
            directory.rename(root/'node')
            with self.assertRaises(ValueError):catalog(root)
    def candidate(self):return {'version':'1.0.0','artifact':{'url':REPOSITORY+'/releases/download/v1.0.0/wallet.tar','sha256':'a'*64,'bytes':100},'capabilities':['readWallet'],'signature':{'algorithm':'ML-DSA-87','provider':'APQE','keyId':'release-test','value':base64.b64encode(bytes(4627)).decode()},'qualification':{'profile':'test-only','reportSha256':'b'*64}}
    def test_structural_metadata_is_not_crypto_verification(self):release(self.candidate())
    def test_classical_signature_rejected(self):
        value=self.candidate();value['signature']['algorithm']='Ed25519'
        with self.assertRaises(ValueError):release(value)
    def test_unsigned_rejected(self):
        value=self.candidate();value['signature']=None
        with self.assertRaises(ValueError):release(value)
    def test_external_or_mutable_artifact_rejected(self):
        for url in ('https://evil.example/wallet.tar',REPOSITORY+'/releases/latest/download/wallet.tar',REPOSITORY+'/releases/download/v1.0.0/wallet.tar?token=bad'):
            value=self.candidate();value['artifact']['url']=url
            with self.assertRaises(ValueError):release(value)
    def test_wrong_digest_size_capability_signature(self):
        for mutate in (lambda v:v['artifact'].update(sha256='bad'),lambda v:v['artifact'].update(bytes=268435457),lambda v:v.update(capabilities=['shell']),lambda v:v['signature'].update(value='AAAA')):
            value=self.candidate();mutate(value)
            with self.assertRaises(ValueError):release(value)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent.parent);parser.add_argument('--generate',action='store_true');parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
    if args.self_test:
        PolicyTests.registry_root=args.root.resolve()
        result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(PolicyTests))
        if not result.wasSuccessful():return 1
    result=catalog(args.root.resolve());expected=json.dumps(result,indent=2,ensure_ascii=False)+'\n';destination=args.root/'registry/catalog.json'
    if args.generate:destination.write_text(expected,encoding='utf8')
    else:require(destination.is_file() and destination.read_text(encoding='utf8')==expected,'Generated catalog drift: run python3 registry/validate.py --generate')
    print(f'Validated {len(result["apps"])} inert app manifests; metadata grants no installation authority.')
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,TypeError,KeyError,OSError) as error:print(f'Registry rejected: {error}',file=sys.stderr);sys.exit(1)
