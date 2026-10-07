ENCOM_GRID = docker run --rm -it --init --pull always \
  -v "$(CURDIR)":"$(CURDIR)" -w "$(CURDIR)" \
  -v "$(HOME)/.encom-grid":/home/dev/.encom-grid \
  -v "$(HOME)/.gitconfig":/home/dev/.gitconfig:ro \
  ghcr.io/daemon-solutions/encom-grid:claude

encom-claude:
	$(ENCOM_GRID)

encom-setup:
	$(ENCOM_GRID) bash -c "aidlc config --harness claude && aidlc config --pin 2.10.0 && aidlc doctor"
