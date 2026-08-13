# Git Replay — root-level convenience commands (no cd-ing into apps/desktop).
# Portable across cmd.exe and sh (GNU Make for Windows picks whichever).
# Note: `make kill` is needed before cargo builds while the app is running —
# the running git-replay.exe locks target/debug/git-replay.exe.

DESKTOP := apps/desktop

.PHONY: help dev build test test-engine lint fix check selftest kill release

help:
	@echo Git Replay commands:
	@echo   make dev          run the app, dev server and window
	@echo   make build        typecheck and bundle the frontend
	@echo   make test         frontend unit tests, vitest
	@echo   make test-engine  engine tests, cargo
	@echo   make lint         biome check
	@echo   make fix          biome check --write, format and fix
	@echo   make check        everything: lint, build, all tests
	@echo   make selftest     run the app with the in-app end-to-end audit
	@echo   make kill         kill a running git-replay.exe, unlocks cargo builds
	@echo   make release      build installers, tauri build

dev:
	cd $(DESKTOP) && npm run tauri dev

build:
	cd $(DESKTOP) && npm run build

test:
	cd $(DESKTOP) && npm test

test-engine:
	cd $(DESKTOP)/src-tauri && cargo test

lint:
	cd $(DESKTOP) && npm run lint

fix:
	cd $(DESKTOP) && npm run lint:fix

check:
	cd $(DESKTOP) && npm run lint:ci && npm run build && npm test && cd src-tauri && cargo test

selftest: export VITE_SELFTEST := 1
selftest:
	cd $(DESKTOP) && npm run tauri dev

kill:
	-taskkill /F /IM git-replay.exe

release:
	cd $(DESKTOP) && npm run tauri build
