// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webclient

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"golang.org/x/net/websocket"
)

func TestTrayStreamReconnectsAndStopsOnRevocation(t *testing.T) {
	var connections atomic.Int32
	firstNotice := `{"type":"channel","body":{"id":"camp-desktop-tray","type":"notification","body":{"id":"notice","type":"reply","user":{"name":"QA Peer"}}}}`
	message := `{"type":"channel","body":{"id":"camp-desktop-tray","type":"newChatMessage","body":{"id":"message","fromUserId":"peer","fromUser":{"username":"peer"},"text":"private text"}}}`
	ws := websocket.Handler(func(conn *websocket.Conn) {
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		request := conn.Request()
		if request.URL.Path != "/client-streaming" || request.URL.RawQuery != "" ||
			request.Header.Get("Authorization") != "Bearer cs_local_test" || request.Header.Get("X-Camp-Client") != "desktop-v1" ||
			request.Header.Get("X-Camp-Desktop-Version") != "0.1.0" || request.Header.Get("X-Camp-Host-Api") != "2" {
			t.Error("invalid desktop stream authentication")
		}
		var subscribe string
		if err := websocket.Message.Receive(conn, &subscribe); err != nil ||
			!strings.Contains(subscribe, `"channel":"main"`) || !strings.Contains(subscribe, trayChannelID) {
			t.Error("native stream did not subscribe to the active user's main channel")
			return
		}
		_ = websocket.Message.Send(conn, `{"type":"connected","body":{"id":"camp-desktop-tray"}}`)
		_ = websocket.Message.Send(conn, firstNotice)
		if connections.Add(1) == 2 {
			_ = websocket.Message.Send(conn, message)
			_ = websocket.Message.Send(conn, `{"type":"clientSessionRevoked","body":{}}`)
		}
	})
	server := httptest.NewServer(ws)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	var got []mygo.NotificationOptions
	runTrayStream(ctx, server.URL, "0.1.0", traySession{ID: "me", Token: "cs_local_test", MuteChat: true}, func(notice mygo.NotificationOptions) {
		got = append(got, notice)
	})
	if ctx.Err() != nil || connections.Load() != 2 {
		t.Fatal("expected one reconnect and immediate stop on revocation")
	}
	if len(got) != 2 || got[0].Title != "QA Peer" || got[0].Body != "回复了你的帖子" || got[0].Silent ||
		got[1].Title != "@peer" || !got[1].Silent || strings.Contains(got[1].Body, "private text") {
		t.Fatalf("unexpected desktop notifications: %+v", got)
	}
}

func TestTrayNoticeRejectsDeniedAndUnrelatedEvents(t *testing.T) {
	const notice = `{"id":"camp-desktop-tray","type":"notification","body":{"id":"notice"}}`
	if _, ok := decodeTrayNotice([]byte(notice), traySession{Denied: true}); ok {
		t.Fatal("explicitly denied notification was delivered")
	}
	for _, event := range []string{
		`{"id":"other-channel","type":"notification","body":{"id":"notice"}}`,
		`{"id":"camp-desktop-tray","type":"newChatMessage","body":{"id":"message","fromUserId":"me"}}`,
	} {
		if _, ok := decodeTrayNotice([]byte(event), traySession{ID: "me"}); ok {
			t.Fatal("unrelated or self-originated event produced a notification")
		}
	}
}
