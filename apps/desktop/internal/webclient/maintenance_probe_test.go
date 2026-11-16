// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stellasora-cafe/trekker-camp/apps/desktop/internal/webfrontend"
)

func TestMaintenanceRecoveryRequiresRedirectedTargets(t *testing.T) {
	var loginMaintenance, signupMaintenance, manifestMaintenance, homeMaintenance atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.URL.Path == "/" && homeMaintenance.Load()) ||
			(r.URL.Path == "/desktop-auth" && r.URL.Query().Get("mode") == "signin" && loginMaintenance.Load()) ||
			(r.URL.Path == "/desktop-auth" && r.URL.Query().Get("mode") == "signup" && signupMaintenance.Load()) ||
			(r.URL.Path == webfrontend.UpdatePath && manifestMaintenance.Load()) {
			http.Redirect(w, r, "/__camp-maintenance/v1.html#/", 302)
			return
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	c := &client{origin: server.URL}
	c.maintenanceRetries.Store("login", server.URL+"/desktop-auth?mode=signin")
	c.maintenanceRetries.Store("signup", server.URL+"/desktop-auth?mode=signup")
	c.maintenanceProbeTargets.Store(server.URL+webfrontend.UpdatePath, struct{}{})
	assertActive := func(want bool) {
		t.Helper()
		active, err := c.probeMaintenance(context.Background())
		if err != nil || active != want {
			t.Fatalf("active=%v err=%v want=%v", active, err, want)
		}
	}
	homeMaintenance.Store(true)
	assertActive(true)
	homeMaintenance.Store(false)
	loginMaintenance.Store(true)
	assertActive(true)
	loginMaintenance.Store(false)
	signupMaintenance.Store(true)
	assertActive(true)
	signupMaintenance.Store(false)
	manifestMaintenance.Store(true)
	assertActive(true)
	manifestMaintenance.Store(false)
	assertActive(false)
	server.Close()
	if active, err := c.probeMaintenance(context.Background()); active || err == nil {
		t.Fatalf("offline must not signal recovery: %v %v", active, err)
	}
}
