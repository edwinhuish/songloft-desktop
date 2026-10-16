; NSIS 安装包额外的一段（electron-builder.yml 的 nsis.include 指向它）。
;
; ── 为什么需要它 ─────────────────────────────────────────────────────────────
; win.extraFiles 会把一个标记文件（portable.txt）放在 exe 旁边，那是给**免安装 zip 版**用的：
; 应用启动时看到它，就认为「我是解压出来的一份」，于是把设置 / 凭据 / 缓存写在自己目录下的
; data\ 里（判据见 src/shared/user-data.ts）。
;
; 但 extraFiles 是**平台级**的，它同样会进 NSIS 安装包 —— 装完之后 exe 旁边也有这个标记，
; 安装版就会把用户数据写进安装目录（%LOCALAPPDATA%\Programs\… 或用户自己选的 D:\…），
; 而不是 %APPDATA%。那意味着卸载、重装、换个安装目录，配置就跟着搬家或者直接丢。
;
; electron-builder 没有「只给某一个 target 加文件」的口子，所以反过来做：文件照样进包，
; **装完之后删掉它**。于是装出来的应用没有标记 → 走系统默认位置；zip 版没人删它 → 绿色模式。
;
; customInstall 的插入点在 installSection.nsh 里是「文件拷完、快捷方式与文件关联注册完之后」，
; 正好是能删到它的位置。
!macro customInstall
  Delete "$INSTDIR\portable.txt"
!macroend
