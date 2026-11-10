import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
// Each application emits its own artifact; Portal APIs and React are supplied by the host.
export default defineConfig({plugins:[react()],build:{lib:{entry:resolve(process.cwd(),'src/index.jsx'),formats:['es'],fileName:'application'},rolldownOptions:{external:id=>id==='@tauri-apps/api/core'||id==='react'||id.startsWith('react/')||id==='react-dom'||id.startsWith('@synergy-network/portal-native/')}}});
