// This source registry discovers bundled implementations; host installation/permission gates still apply.
export const knownApplicationLoaders=Object.freeze({
 learn:()=>import("@synergy-network/dapp-learn").then(module=>({default:module.LearnApp})),
 wallet:()=>import("@synergy-network/dapp-wallet").then(module=>({default:module.WalletApp})),
 atlas:()=>import("@synergy-network/dapp-atlas").then(module=>({default:module.AtlasApp})),
 keystone:()=>import("@synergy-network/dapp-keystone").then(module=>({default:module.KeystoneApp})),
 node:()=>import("@synergy-network/dapp-nodenetwork").then(module=>({default:module.NodeApp})),
});
