// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package campweb

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPreloadOriginValidation(t *testing.T) {
	for _, origin := range []string{"https://camp.example", "http://localhost:3000/", "http://127.0.0.1:3000", "http://[::1]:3000", "http://127.0.0.2"} {
		if _, err := Preload(origin, "windows"); err != nil {
			t.Errorf("valid origin rejected: %s", origin)
		}
	}
	for _, origin := range []string{"", "http://camp.example", "file:///admin", "https://name:secret@camp.example", "https://camp.example/admin", "https://camp.example?i=credential", "https://camp.example#fragment"} {
		if _, err := Preload(origin, "windows"); err == nil {
			t.Errorf("invalid origin accepted: %s", origin)
		}
	}
}

func TestPreloadBrowserTransport(t *testing.T) {
	script, err := Preload("http://localhost:3000/", "windows")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", "preload_test.cjs")
	cmd.Stdin = strings.NewReader(script)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser transport checks failed: %v\n%s", err, output)
	}
}
