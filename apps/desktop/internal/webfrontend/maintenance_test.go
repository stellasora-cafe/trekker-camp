// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webfrontend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMaintenanceRedirects(t *testing.T) {
	for _, target := range []string{"/__camp-maintenance/v1.html#/", "https://camp.stellasora.cafe/__camp-maintenance/v1.html#/"} {
		t.Run(target, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target, 302) }))
			active, err := ProbeOrigin(context.Background(), s.URL)
			if err != nil || !active {
				t.Fatalf("maintenance not detected: %v %v", active, err)
			}
			s.Close()
			active, err = ProbeOrigin(context.Background(), s.URL)
			if err == nil || active {
				t.Fatal("network failure treated as maintenance")
			}
		})
	}
	for _, target := range []string{"https://other.invalid/__camp-maintenance/v1.html", "https://camp.stellasora.cafe/fake", "https://camp.stellasora.cafe.evil.invalid/__camp-maintenance/v1.html"} {
		if IsMaintenanceURL("https://local.invalid", target) {
			t.Fatal("accepted unrelated URL", target)
		}
	}
}

func TestProbeTargetRejectsForeignOriginAndServerFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer server.Close()
	if active, err := ProbeTarget(context.Background(), server.URL, server.URL+"/desktop-auth?mode=signup"); active || err == nil {
		t.Fatalf("server failure treated as recovery: %v %v", active, err)
	}
	if _, err := ProbeTarget(context.Background(), server.URL, "https://other.invalid/"); err == nil {
		t.Fatal("foreign target accepted")
	}
}
