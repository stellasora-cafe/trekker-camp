// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webclient

import "testing"

func TestFailedRequiredUpdateCanReturnToEditorWithoutClearingGate(t *testing.T) {
	c := &client{}
	c.packageRequired.Store(true)
	p := &packageUpdatePrompt{client: c, required: true, busy: true}
	if p.resumeEditing() {
		t.Fatal("active update can be dismissed")
	}
	p.busy = false
	if p.resumeEditing() {
		t.Fatal("required update dismissed without failed safety check")
	}
	p.failedRestartPreparation()
	if !p.safetyFailed || !p.resumeEditing() || !p.exiting {
		t.Fatal("failed draft save trapped the editor")
	}
	if !c.packageRequired.Load() {
		t.Fatal("returning to editor cleared the server gate")
	}
	ordinary := &packageUpdatePrompt{client: c}
	ordinary.failedRestartPreparation()
	if ordinary.safetyFailed || ordinary.resumeEditing() {
		t.Fatal("ordinary prompt offered required-update recovery")
	}
}

func TestRequiredPackageVersion(t *testing.T) {
	for _, test := range []struct {
		available, minimum string
		allowed            bool
	}{
		{"0.1.0", "0.1.0", true},
		{"0.1.1", "0.1.0", true},
		{"0.10.0", "0.2.0", true},
		{"1.0.0", "0.99.99", true},
		{"0.1.0", "0.1.1", false},
		{"0.2.0", "0.10.0", false},
		{"0.1.0", "invalid", false},
		{"0.1.0-beta.1", "0.1.0", false},
		{"0.1", "0.1.0", false},
		{"0.1.0", "", true},
	} {
		if got := packageVersionAtLeast(test.available, test.minimum); got != test.allowed {
			t.Errorf("available %s / required %s = %v", test.available, test.minimum, got)
		}
	}
}

func TestGuestAboutOpensNativeWithoutWebsite(t *testing.T) {
	native, website := 0, 0
	panel := &guestPanel{callbacks: guestCallbacks{
		AboutCamp: func() { native++ },
		OpenTool:  func(string) { website++ },
	}}
	panel.tool("/about-camp")
	if native != 1 || website != 0 {
		t.Fatal("about page requested website")
	}
	panel.tool("/desktop-auth?mode=signin")
	if website != 1 {
		t.Fatal("normal login routing changed")
	}
}

func TestDesktopAboutSourceMatchesRelease(t *testing.T) {
	if got := desktopSourceURL("1.2.3"); got != campRepositoryURL+"/tree/desktop-v1.2.3" {
		t.Fatal(got)
	}
	if got := desktopSourceURL(""); got != campRepositoryURL {
		t.Fatal(got)
	}
}
