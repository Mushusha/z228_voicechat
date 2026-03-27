package rtcconfig

import "testing"

func TestBuildIceServersMergesSources(t *testing.T) {
	got := BuildIceServers(
		`[{"urls":"stun:extra.example.org:3478"}]`,
		"turn:a.example.org:3478?transport=udp, turn:a.example.org:3478?transport=tcp",
		"user",
		"pass",
		true,
	)

	if len(got) != 4 {
		t.Fatalf("len(BuildIceServers) = %d, want 4", len(got))
	}
	turn, ok := got[3]["urls"].([]string)
	if !ok || len(turn) != 2 {
		t.Fatalf("TURN urls = %#v, want 2 urls", got[3]["urls"])
	}
}

func TestBuildIceServersSkipsBrokenTurnConfig(t *testing.T) {
	got := BuildIceServers("", "turn:a.example.org:3478", "", "", false)
	if len(got) != len(DefaultSTUN()) {
		t.Fatalf("len(BuildIceServers) = %d, want only default STUN", len(got))
	}
}
