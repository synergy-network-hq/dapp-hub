//! NodeNetwork native dApp implementation, independent of its Portal host.
pub mod node_network;
pub mod node_controller;
mod node_diagnostics;
#[cfg(unix)]
mod node_master_review;
mod node_removal_scope;
pub mod node_bootstrap;
mod genesis_stage;
pub use genesis_stage::GenesisStageReview;
pub mod commands;
pub mod request_journal;
mod formation;
mod r1_identity_creation;

pub mod operator_authorization;

mod network_formation;

mod authorization_lifecycle;

mod vpn_enrollment;

mod transport_formation;
mod transport_staging;
pub mod transport_commands;

pub mod guest_hosts;

pub mod bare_rollback;

pub mod managed_guest;

pub mod guest_configuration;

pub mod fleet_readiness;

pub mod treasury;
pub mod treasury_send;
mod vpn_credential;

pub mod consensus_observation;
mod gateway_admission;
mod gateway_target;

mod operator_auth;
mod gateway_health;
mod gateway_vpn;
mod gateway_access;
#[cfg(target_os="macos")]
mod operator_credential;

mod runtime_probe;
mod legacy_gateway_plan;
mod legacy_peer_preflight;
mod chain1266_relocation;
