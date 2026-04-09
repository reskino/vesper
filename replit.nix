{pkgs}: {
  deps = [
    pkgs.xvfb-run
    pkgs.playwright-driver
    pkgs.chromium
  ];
}
