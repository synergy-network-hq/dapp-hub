// Pinned Wallet 134cfa2 Draft::parse/review outputs from synthetic Spark fe1d099 vectors.
export const walletInspectionTexts = Object.freeze({
  mint: `{
  "draft_sha256": "70292ed86ae10b7f70b2f031367ad493d9d1d0d73710fb53b26fed3c086c18e5",
  "review": {
    "sender": "synw1ylcxlewqxgnz76tkqycp8julzgp9jg0ppacu",
    "maximum_carrier_gas_price_nwei": 40,
    "maximum_balance_reserve_nwei": "100000000",
    "purchase_price_nwei": "0",
    "payload": {
      "version": 1,
      "chain_id": 1266,
      "network": "synergy-testnet-v3",
      "tx": {
        "op": "mint_nft",
        "data": {
          "collection_id": "synn11vlvh33fjfqzek8kagaltcsfsqxmw7wyke88y57",
          "to": "synw1ylcxlewqxgnz76tkqycp8julzgp9jg0ppacu",
          "metadata_uri": null,
          "metadata_hash": null,
          "metadata_mutable": false,
          "transferable": null,
          "requires_issuer_approval": null,
          "expires_at": null,
          "minted_at": 1794761001
        }
      }
    }
  }
}
`,
  list: `{
  "draft_sha256": "0badc9ef7a5ce9aa5758c0ba28df5ab99dd1f82ec13bbddaeb486989aee72b73",
  "review": {
    "sender": "synw1ptau5vh8eqx8yvjfukpq2yas6fxvay0z7new",
    "maximum_carrier_gas_price_nwei": 40,
    "maximum_balance_reserve_nwei": "100000000",
    "purchase_price_nwei": "0",
    "payload": {
      "version": 1,
      "chain_id": 1266,
      "network": "synergy-testnet-v3",
      "tx": {
        "op": "list_nft_for_snrg",
        "data": {
          "nft_id": "synn11na83utlt390nreuafc70h69yu077p8fumh0c5g",
          "price_nwei": 340282366920938463463374607431768211455,
          "expires_at_height": 5451230
        }
      }
    }
  }
}
`,
  cancel: `{
  "draft_sha256": "a5fe8f3c17711599088f59401b935a7a5ba346a4c82b660b8b7ef70f0da18070",
  "review": {
    "sender": "synw1ptau5vh8eqx8yvjfukpq2yas6fxvay0z7new",
    "maximum_carrier_gas_price_nwei": 40,
    "maximum_balance_reserve_nwei": "100000000",
    "purchase_price_nwei": "0",
    "payload": {
      "version": 1,
      "chain_id": 1266,
      "network": "synergy-testnet-v3",
      "tx": {
        "op": "cancel_nft_sale",
        "data": {
          "nft_id": "synn11na83utlt390nreuafc70h69yu077p8fumh0c5g",
          "listing_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      }
    }
  }
}
`,
  buy: `{
  "draft_sha256": "cf89373a970da7bdef613f4550c170c4440724f976e407d487b8893166549371",
  "review": {
    "sender": "synw1zp7cxme7xm838663yrd43lxtxlw0ck90z4am",
    "maximum_carrier_gas_price_nwei": 40,
    "maximum_balance_reserve_nwei": "100000000",
    "purchase_price_nwei": "340282366920938463463374607431768211455",
    "payload": {
      "version": 1,
      "chain_id": 1266,
      "network": "synergy-testnet-v3",
      "tx": {
        "op": "buy_nft_for_snrg",
        "data": {
          "nft_id": "synn11na83utlt390nreuafc70h69yu077p8fumh0c5g",
          "listing_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "expected_seller": "synw1ptau5vh8eqx8yvjfukpq2yas6fxvay0z7new",
          "price_nwei": 340282366920938463463374607431768211455
        }
      }
    }
  }
}
`,
});
