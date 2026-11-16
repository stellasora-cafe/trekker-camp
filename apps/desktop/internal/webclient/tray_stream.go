// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webclient

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/stellasora-cafe/trekker-camp/apps/desktop/internal/webfrontend"
	"golang.org/x/net/websocket"
)

const trayNoticePrefix = "camp-tray:"
const trayChannelID = "camp-desktop-tray"

type traySession struct {
	ID, Token                           string
	Denied, MuteNotifications, MuteChat bool
}

type trayStreamFrame struct {
	Type string          `json:"type"`
	Body json.RawMessage `json:"body"`
}

var errTraySessionRevoked = errors.New("camp desktop session revoked")

func runTrayStream(ctx context.Context, origin, version string, session traySession, notify func(mygo.NotificationOptions)) {
	backoff := time.Second
	// Deduplicate bounded recent events during stream reconnects.
	recent := make([]string, 0, 128)
	seen := make(map[string]struct{}, cap(recent))
	for ctx.Err() == nil {
		connected, err := listenTrayStream(ctx, origin, version, session, func(notice mygo.NotificationOptions) {
			if ctx.Err() != nil {
				return
			}
			if _, duplicate := seen[notice.ID]; duplicate {
				return
			}
			if len(recent) == cap(recent) {
				delete(seen, recent[0])
				recent = append(recent[:0], recent[1:]...)
			}
			recent = append(recent, notice.ID)
			seen[notice.ID] = struct{}{}
			notify(notice)
		})
		if errors.Is(err, errTraySessionRevoked) || ctx.Err() != nil {
			return
		}
		if connected {
			backoff = time.Second
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			backoff = min(backoff*2, time.Minute)
		}
	}
}

func listenTrayStream(ctx context.Context, origin, version string, session traySession, notify func(mygo.NotificationOptions)) (bool, error) {
	target, err := url.Parse(origin)
	if err != nil {
		return false, err
	}
	target.Path = "/client-streaming"
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	cfg, err := websocket.NewConfig(target.String(), origin)
	if err != nil {
		return false, err
	}
	cfg.Header.Set("Authorization", "Bearer "+session.Token)
	cfg.Header.Set("X-Camp-Client", "desktop-v1")
	cfg.Header.Set("X-Camp-Desktop-Version", version)
	cfg.Header.Set("X-Camp-Host-Api", strconv.Itoa(webfrontend.HostAPI))
	dial, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cfg.Dialer = &net.Dialer{KeepAlive: 30 * time.Second}
	conn, err := cfg.DialContext(dial)
	if err != nil {
		return false, err
	}
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	defer func() {
		_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
		_ = conn.Close()
	}()
	conn.MaxPayloadBytes = 1 << 20
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()

	if err := websocket.Message.Send(conn, `{"type":"connect","body":{"channel":"main","id":"`+trayChannelID+`","pong":true}}`); err != nil {
		return false, err
	}
	_ = conn.SetWriteDeadline(time.Time{})
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if websocket.Message.Send(conn, `{"type":"ping"}`) != nil {
					_ = conn.SetReadDeadline(time.Now())
					return
				}
				_ = conn.SetWriteDeadline(time.Time{})
			}
		}
	}()
	connected := false
	for ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(65 * time.Second))
		if ctx.Err() != nil {
			return connected, ctx.Err()
		}
		var data []byte
		if err := websocket.Message.Receive(conn, &data); err != nil {
			return connected, err
		}
		var frame trayStreamFrame
		if json.Unmarshal(data, &frame) != nil {
			continue
		}
		switch frame.Type {
		case "clientSessionRevoked":
			return connected, errTraySessionRevoked
		case "connected":
			var body struct{ ID string }
			connected = connected || (json.Unmarshal(frame.Body, &body) == nil && body.ID == trayChannelID)
		case "channel":
			if notice, ok := decodeTrayNotice(frame.Body, session); ok {
				notify(notice)
			}
		}
	}
	return connected, ctx.Err()
}

func decodeTrayNotice(raw json.RawMessage, session traySession) (mygo.NotificationOptions, bool) {
	var event struct {
		ID, Type string
		Body     json.RawMessage
	}
	if session.Denied || json.Unmarshal(raw, &event) != nil || event.ID != trayChannelID {
		return mygo.NotificationOptions{}, false
	}
	type person struct{ Name, Username string }
	var data struct {
		ID, Type, UserID, FromUserID, ToRoomID string
		User, FromUser                         person
		ToRoom                                 struct{ Name string }
	}
	if json.Unmarshal(event.Body, &data) != nil || data.ID == "" {
		return mygo.NotificationOptions{}, false
	}
	name := func(user person) string {
		if value := strings.TrimSpace(user.Name); value != "" {
			return value
		}
		if user.Username != "" {
			return "@" + user.Username
		}
		return "旅人营地"
	}
	switch event.Type {
	case "newChatMessage":
		if data.FromUserID == session.ID {
			return mygo.NotificationOptions{}, false
		}
		body := "发来一条心链消息"
		if data.ToRoomID != "" && data.ToRoom.Name != "" {
			body = "在「" + data.ToRoom.Name + "」发来一条心链消息"
		}
		return mygo.NotificationOptions{ID: trayNoticePrefix + "chat:" + data.ID, Title: name(data.FromUser), Body: body, Silent: session.MuteChat}, true
	case "notification":
		body := "你有一条新通知"
		switch data.Type {
		case "reply":
			body = "回复了你的帖子"
		case "mention":
			body = "在帖子中提到了你"
		case "reaction":
			body = "回应了你的帖子"
		case "renote", "quote":
			body = "转发了你的帖子"
		case "follow":
			body = "关注了你"
		case "receiveFollowRequest":
			body = "向你发送了关注请求"
		}
		return mygo.NotificationOptions{ID: trayNoticePrefix + "notification:" + data.ID, Title: name(data.User), Body: body, Silent: session.MuteNotifications}, true
	default:
		return mygo.NotificationOptions{}, false
	}
}
