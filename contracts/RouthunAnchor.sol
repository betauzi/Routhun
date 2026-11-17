// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stores only SHA-256 Merkle roots. Never store donor data or evidence on chain.
/// @dev Deployment and ownership management are deliberately separate from the web app.
contract RouthunAnchor {
    address public immutable owner;
    mapping(bytes32 => bytes32) private roots;

    event BatchAnchored(bytes32 indexed batchId, bytes32 indexed root, uint256 timestamp);
    error Unauthorized();
    error AlreadyAnchored();
    error InvalidRoot();

    constructor(address owner_) {
        if (owner_ == address(0)) revert Unauthorized();
        owner = owner_;
    }

    function anchor(bytes32 batchId, bytes32 root) external {
        if (msg.sender != owner) revert Unauthorized();
        if (root == bytes32(0)) revert InvalidRoot();
        if (roots[batchId] != bytes32(0)) revert AlreadyAnchored();
        roots[batchId] = root;
        emit BatchAnchored(batchId, root, block.timestamp);
    }

    function rootOf(bytes32 batchId) external view returns (bytes32) {
        return roots[batchId];
    }
}
