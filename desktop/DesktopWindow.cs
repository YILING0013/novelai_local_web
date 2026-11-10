using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class DesktopWindow : Form
{
    private const string Title = "NovelAI Local";
    private readonly LocalDesktop app;
    internal readonly string Role;
    private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    private readonly Label splash;
    private bool ready, approved, checkingClose;
    internal readonly TaskCompletionSource<bool> PageReady = new TaskCompletionSource<bool>();

    internal DesktopWindow(LocalDesktop app, string role)
    {
        this.app = app;
        Role = role;
        Text = Title;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = role != "auth";
        StartPosition = FormStartPosition.Manual;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        using (var graphics = CreateGraphics())
        {
            float scale = graphics.DpiX / 96f;
            Size = new Size(Math.Min(area.Width, (int)((role == "auth" ? 960 : 1440) * scale)),
                            Math.Min(area.Height, (int)((role == "auth" ? 660 : 940) * scale)));
            MinimumSize = new Size(Math.Min(area.Width, (int)((role == "auth" ? 720 : 800) * scale)),
                                   Math.Min(area.Height, (int)(480 * scale)));
        }
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
        BackColor = Color.FromArgb(24, 28, 34);
        splash = new Label { Text = "NovelAI Local", Dock = DockStyle.Fill, ForeColor = Color.White,
            TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 20, FontStyle.Bold) };
        Controls.Add(view);
        Controls.Add(splash);
    }

    protected override CreateParams CreateParams
    {
        get {
            var p = base.CreateParams;
            p.Style &= ~0x00C00000; // WS_CAPTION; retain the OS resize frame and taskbar behaviour.
            return p;
        }
    }

    internal async Task LoadStudio(CoreWebView2Environment environment)
    {
        await view.EnsureCoreWebView2Async(environment);
        if (IsDisposed) return;
        var core = view.CoreWebView2;
        app.ConfigureRequests(core);
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsNonClientRegionSupportEnabled = true;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.NavigationStarting += (s, e) => { if (!LocalDesktop.StudioUrl(e.Uri)) e.Cancel = true; };
        core.WebMessageReceived += (s, e) => {
            if (!LocalDesktop.StudioUrl(e.Source)) return;
            string action;
            try { action = e.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
            switch (action)
            {
                case "ready":
                    ready = true; splash.Visible = false; PageReady.TrySetResult(true); SendWindowState(); break;
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "maximize":
                    if (MaximizeBox) WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                    break;
                case "close": Close(); break;
                case "auth": case "workspace": case "local": app.Switch(this, action); break;
                case "signed-out": app.Switch(this, "auth", true); break;
                case "folder":
                    BeginInvoke((Action)ChooseDirectory);
                    break;
            }
        };
        core.NewWindowRequested += (s, e) => app.OpenPreview(this, core, e);
        core.NavigationCompleted += (s, e) => {
            if (!e.IsSuccess || e.HttpStatusCode >= 400)
                PageReady.TrySetException(new IOException("无法加载桌面界面。请重新安装 NovelAI Local。"));
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "if(location.origin==='" + LocalDesktop.Origin + "')Object.defineProperty(window,'novelaiLocalDesktop',{value:true});");
        core.Navigate(LocalDesktop.Origin + "/studio/index.html#" + Role);
        if (await Task.WhenAny(PageReady.Task, Task.Delay(45000)) != PageReady.Task)
            throw new TimeoutException("桌面界面启动超时。");
        await PageReady.Task;
    }

    internal async Task<bool> CanLeave()
    {
        if (!ready) return true;
        var clean = await view.CoreWebView2.ExecuteScriptAsync(
            "window.dispatchEvent(new Event('beforeunload',{cancelable:true}))");
        if (clean != "false") return true;
        return MessageBox.Show(this, "当前工具有尚未保存的内容，确定离开吗？\nLeave the workspace with unsaved changes?",
            Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    private void ChooseDirectory()
    {
        using (var dialog = new FolderBrowserDialog { ShowNewFolderButton = true })
        {
            var path = dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : "";
            if (!IsDisposed) view.CoreWebView2.PostWebMessageAsString("folder:" + path);
        }
    }

    internal void Retire() { approved = true; Close(); }

    private void SendWindowState()
    {
        if (ready && !IsDisposed) view.CoreWebView2.PostWebMessageAsString(WindowState == FormWindowState.Maximized ? "maximized" : "normal");
    }
    protected override void OnResize(EventArgs e) { base.OnResize(e); SendWindowState(); }
    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        if (!approved && ready && e.CloseReason != CloseReason.WindowsShutDown)
        {
            e.Cancel = true;
            if (checkingClose) return;
            checkingClose = true;
            try { if (await CanLeave()) BeginInvoke((Action)Retire); }
            catch (Exception) { BeginInvoke((Action)Retire); }
            finally { checkingClose = false; }
            return;
        }
        base.OnFormClosing(e);
    }
}
