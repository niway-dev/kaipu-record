# main/infrastructure

Side-effecting adapters for the **main** process: IPC handler registration,
filesystem persistence, window management, ffmpeg, etc.

Keep this layer thin — it wires Electron/Node APIs to the pure logic in
`main/services`. The pure logic is where the unit tests live; code here is
usually integration-tested or left untested if it is trivial wiring.
