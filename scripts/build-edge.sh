#!/usr/bin/env bash
# Build all edge IIFE bundles for a given vite config
CONFIG="${1:?Usage: build-edge.sh <vite-config-file>}"
ENTRY=stats-bar vite build --config "$CONFIG" && \
ENTRY=debug-panel vite build --config "$CONFIG" && \
ENTRY=dashboard vite build --config "$CONFIG"
