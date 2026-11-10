import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],root:'examples',resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:1430,strictPort:true,fs:{allow:['..']}},build:{outDir:'../dist-preview',emptyOutDir:true}});
