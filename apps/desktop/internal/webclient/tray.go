// SPDX-FileCopyrightText: trekker-camp contributors
// SPDX-License-Identifier: Apache-2.0

package webclient

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

//go:embed tray-icon.png
var trayIcon []byte

func (c *client) configureTrayLifecycle() {
	mygo.App.OnSecondInstance(func([]string, string) { c.restoreFromTray() })
	mygo.App.OnWindowAllClosed(func() {
		if !c.inTray.Load() {
			mygo.App.Quit()
		}
	})
	if runtime.GOOS != "windows" {
		return
	}
	_ = c.ensureTray()
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { c.quitting = true })
	mygo.App.OnQuitCanceled(func() { c.quitting = false })
	mygo.App.OnQuit(func() {
		c.stopTray()
		c.cancel()
	})
	mygo.App.OnNotificationClick(func(id string) {
		if strings.HasPrefix(id, trayNoticePrefix) {
			c.restoreFromTray()
		}
	})
}

func (c *client) attachTrayClose(window *mygo.Window) {
	if runtime.GOOS != "windows" {
		return
	}
	window.OnClose(func(event *mygo.CloseEvent) {
		if c.quitting {
			return
		}
		event.PreventDefault()
		if !c.trayClosing {
			c.trayClosing = true
			go c.closeMainWindow(window)
		}
	})
}

func (c *client) closeMainWindow(window *mygo.Window) {
	c.windowMu.Lock()
	current := c.window == window && !c.changingWindow && !c.guest
	c.windowMu.Unlock()
	var session traySession
	var err error
	if current {
		session, err = c.readTraySession(window)
		if err == nil && session.ID != "" && !c.prepareWindowExit(true, true) {
			err = errors.New("请先完成当前编辑、上传或弹窗操作，再关闭窗口。")
		}
	}
	mygo.RunOnMain(func() {
		c.trayClosing = false
		c.windowMu.Lock()
		current := current && c.window == window && !c.changingWindow
		c.windowMu.Unlock()
		if !current || c.quitting || window.IsDestroyed() || c.ctx.Err() != nil {
			return
		}
		if err != nil {
			c.showCloseDialog(window, "暂时无法关闭", err.Error(), nil)
			return
		}
		if session.ID == "" {
			// The account can clear before the web-to-welcome transition.
			mygo.App.Quit()
			return
		}
		action := c.closeBehavior.get()
		if action == closeAsk {
			c.showCloseDialog(window, "关闭按钮行为", "收进托盘后仍可接收通知和心链消息。选择会自动保存，可在偏好设置中更改。", func(action closeBehavior) {
				if window.IsDestroyed() || c.quitting || c.ctx.Err() != nil {
					return
				}
				if err := c.closeBehavior.set(action); err != nil {
					c.showCloseDialog(window, "暂时无法保存", "无法保存关闭按钮行为，请重试。", nil)
					return
				}
				c.trayClosing = true
				go c.closeMainWindow(window)
			})
			return
		}
		c.performWindowClose(window, action, session)
	})
}

func (c *client) showCloseDialog(parent *mygo.Window, title, detail string, choose func(closeBehavior)) {
	c.trayClosing = true
	var dialog *mygo.Window
	finish := func(action closeBehavior) {
		dialog.Destroy()
		if choose != nil && action != closeAsk {
			choose(action)
		}
	}
	dialog = mygo.NewWindow(mygo.WindowOptions{
		Parent: parent, Modal: true, Title: title, Width: 456, Height: 224,
		UseContentSize: true, Frameless: true, CornerRadius: 20, SkipTaskbar: true,
		DisableResize: true, DisableMinimize: true, DisableMaximize: true, DisableFullScreen: true,
		BackgroundColor: "light-dark(#ffffff,#252733)",
		Content: ui.View(func(ctx *ui.Context) {
			t := permissionTheme(ctx.Theme().Dark)
			ctx.OnWindowShortcut(0, ui.KeyEscape, func() { finish(closeAsk) })
			ui.Themed(ctx, t).Fill().Padding(20, 24, 22, 24).Gap(14).Background(t.Background).DragWindow().
				Role(ui.RoleDialog).Label(title).Children(func() {
				ui.Row(ctx).AlignItems(ui.Center).Gap(12).FillWidth().Children(func() {
					ui.Box(ctx).Size(42, 42).Radius(14).Background(t.Accent.Alpha(.12)).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
						ui.Icon(ctx, permissionIcons[mygo.PermissionNotifications]).Size(22, 22).TextColor(t.Accent)
					})
					ui.Text(ctx, title).FontSize(20).Bold().Unselectable()
				})
				ui.Text(ctx, detail).FillWidth().FontSize(14).TextColor(t.Text).Unselectable()
				ui.Spacer(ctx)
				ui.Row(ctx).FillWidth().Justify(ui.End).Gap(8).Children(func() {
					if choose == nil {
						ui.PrimaryButton(ctx.Key("confirm"), "知道了").Height(38).OnClick(func() { finish(closeAsk) })
						return
					}
					ui.Button(ctx.Key("cancel"), "取消").Height(38).AutoFocus().OnClick(func() { finish(closeAsk) })
					ui.Button(ctx.Key("quit"), "退出应用").Height(38).OnClick(func() { finish(closeQuit) })
					ui.PrimaryButton(ctx.Key("tray"), "收进托盘").Height(38).OnClick(func() { finish(closeTray) })
				})
				nativeCaptionControl(ctx, t, "close", "关闭弹窗", campCloseIcon, func() { finish(closeAsk) }).Absolute().Right(0).Top(0)
			})
		}),
	})
	dialog.OnClosed(func() { c.trayClosing = false })
}

func (c *client) performWindowClose(window *mygo.Window, action closeBehavior, session traySession) {
	c.windowMu.Lock()
	valid := c.window == window && !c.guest && !c.changingWindow
	c.windowMu.Unlock()
	if !valid || window.IsDestroyed() {
		return
	}
	if action == closeQuit {
		mygo.App.Quit()
		return
	}
	if err := c.ensureTray(); err != nil {
		c.showCloseDialog(window, "暂时无法收起", "未能创建托盘图标，请重试。", nil)
		return
	}
	c.inTray.Store(true)
	c.windowMu.Lock()
	c.window, c.mainFrontend = nil, nil
	c.windowMu.Unlock()
	c.closePermissionPrompts()
	for _, open := range mygo.Windows() {
		open.Destroy()
	}
	if strings.HasPrefix(session.Token, "cs_") && !session.Denied {
		ctx, cancel := context.WithCancel(c.ctx)
		c.trayCancel = cancel
		version := mygo.App.Version()
		if version == "" {
			version = "0.1.0"
		}
		go runTrayStream(ctx, c.origin, version, session, func(notice mygo.NotificationOptions) {
			mygo.RunOnMain(func() {
				if ctx.Err() == nil && c.inTray.Load() && !c.quitting {
					_ = mygo.NewNotification(notice).ShowContext(ctx)
				}
			})
		})
	}
}

func (c *client) ensureTray() error {
	if c.tray != nil {
		return nil
	}
	menu := mygo.NewMenu([]*mygo.MenuItem{
		{Label: "打开旅人营地", Click: func(*mygo.MenuItem, *mygo.Window) { c.restoreFromTray() }},
		mygo.Separator(),
		{Label: "退出旅人营地", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
	})
	tray, err := mygo.NewTray(mygo.TrayOptions{ID: "camp", Icon: trayIcon, ToolTip: "旅人营地", Menu: menu})
	if err != nil {
		return err
	}
	c.tray = tray
	tray.OnClick(c.restoreFromTray)
	return nil
}

func (c *client) stopTray() {
	if c.trayCancel != nil {
		c.trayCancel()
		c.trayCancel = nil
	}
	if c.tray != nil {
		c.tray.Destroy()
		c.tray = nil
	}
}

func (c *client) restoreFromTray() {
	mygo.RunOnMain(func() {
		if c.quitting {
			return
		}
		if !c.inTray.CompareAndSwap(true, false) {
			c.windowMu.Lock()
			window := c.window
			c.windowMu.Unlock()
			if window != nil && !window.IsDestroyed() {
				window.Show()
				if window.IsMinimized() {
					window.Restore()
				}
				window.Focus()
			}
			return
		}
		if c.trayCancel != nil {
			c.trayCancel()
			c.trayCancel = nil
		}
		if c.packageRequired.Load() {
			// Recheck compatibility with a visible parent for an update prompt.
			c.packageRequired.Store(false)
		}
		c.openBootstrap()
	})
}

func (c *client) readTraySession(window *mygo.Window) (traySession, error) {
	const failure = "未能读取当前登录会话，请等营地加载完成后重试。"
	var session traySession
	page := window.Page()
	expected, _ := json.Marshal(c.origin)
	ctx, cancel := context.WithTimeout(c.ctx, 3*time.Second)
	defer cancel()
	result, err := page.EvalContext(ctx, `(()=>{
if(window!==top||location.origin!==`+string(expected)+`)return null;
const account=JSON.parse(localStorage.getItem('account'));
if(!account)return '{}';
if(typeof account.id!=='string'||typeof account.token!=='string')return null;
let prefs;
try { prefs=JSON.parse(localStorage.getItem('preferences'))?.preferences; } catch {}
const pref=key=>prefs?.[key]?.find?.(row=>row?.[0]?.account==null&&row?.[0]?.server==null&&row?.[0]?.device==null)?.[1];
const muted=pref('sound.notUseSound')===true||pref('sound.useSoundOnlyWhenActive')===true||pref('sound.masterVolume')===0;
const silent=key=>muted||pref(key)?.volume===0||pref(key)?.type==null&&pref(key)!=null;
return JSON.stringify({id:account.id,token:account.token,denied:window.Notification?.permission==='denied',
muteNotifications:silent('sound.on.notification'),muteChat:silent('sound.on.chatMessage')});
})()`)
	raw, ok := result.(string)
	if err != nil || !ok || json.Unmarshal([]byte(raw), &session) != nil || (session.ID == "") != (session.Token == "") {
		return traySession{}, errors.New(failure)
	}
	return session, nil
}
