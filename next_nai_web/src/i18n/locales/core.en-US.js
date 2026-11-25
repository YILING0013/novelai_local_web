const messages = {
  imageShare: {
    title: 'Share image',
    tooLarge: 'Skipped a shared image larger than 10 MB.',
    invalid: 'Could not read an image from this share.',
    sendFailed: 'Could not share this image.',
  },
  "desktop": {
    "application": "Desktop application",
    "webOn": "Web access on",
    "webOff": "Web access off",
    "webAccess": "Web access settings",
    "enable": "Enable browser access",
    "hint": "Sign in from a browser on this PC or your private network. LAN connections use HTTP. Enable this only on a trusted network. Access stops when the desktop app closes.",
    "loopback": "On this PC",
    "lan": "On your local network",
    "readFailed": "Could not read access settings. Please retry.",
    "changeFailed": "Could not apply the change. Check that port {port} is available and the application data folder is writable.",
    "restoreFailed": "Web access could not be restored. Check port {port} and turn access on again."
  },
  "librarySettings": {
    "outputDirectory": "Generated image folder",
    "outputHint": "Enter an absolute local path, or leave blank for backend data/generated-images. After saving settings, completed images are written directly to disk without browser auto-downloads.",
    "inspirationSource": "Inspiration gallery source",
    "default": "Built-in examples",
    "references": "Reference gallery",
    "outputs": "Local generated images",
    "localOnly": "Originals, thumbnails, groups, and styles stay on this computer. Changing folders does not move existing files. Manual download remains available.",
    "saveFailed": "The image was generated, but saving to disk failed. Download this result now, then check folder permissions and free space.",
    "sourceFailed": "Could not switch the inspiration gallery. Check the local service.",
    "styleApplied": "Style added to the positive prompt.",
    "loadMore": "Load more"
  },
  "login": {
    "invalidCredentials": "Login failed. Check your account and password.",
    "logoAlt": "NovelAI Local logo",
    "tagline1": "Draw your dreams with AI",
    "tagline2": "Bring inspiration to your creations",
    "tagline3": "Happy creating!",
    "local": {
      "recoveryRequired": "Account recovery must be completed",
      "recoveryDescription": "A credential change was interrupted. Enter both the previous and target credentials to resolve it before continuing.",
      "oldEmail": "Previous email",
      "oldPassword": "Previous password",
      "newEmail": "Target email",
      "newPassword": "Target password",
      "resolveRecovery": "Resolve and continue",
      "pat": "Persistent Access Token",
      "emailPassword": "Email and password",
      "useEmailPassword": "Sign in with email and password",
      "usePat": "Sign in with a persistent access token",
      "email": "Email",
      "passwordCompatibilityNotice": "If NovelAI requires a verification challenge in the future, password login will be unavailable. Use a PAT instead."
    },
    "loggingIn": "Logging in...",
    "password": "Password",
    "login": "Login",
    "or": "or",
    "languageAria": "Choose interface language"
  },
  "main": {
    "resizeSidebar": "Resize navigation sidebar",

    "navigation": "Main navigation",
    "showSidebarIcons": "Show icon menu",
    "hideSidebar": "Hide menu",
    "expandSidebar": "Expand menu",
    "accountDialog": {
      "loadError": "An error occurred while loading account information.",
      "refreshData": "Refresh data"
    },
    "local": {
      "credentialsUpdated": "Credentials and account information were updated.",
      "credentialChangeFailed": "The credential change could not be completed.",
      "loginMode": "Login mode",
      "credentialManagement": "Credential management",
      "loginModePat": "Persistent access token (PAT)",
      "loginModePassword": "Email and password",
      "officialAccount": "NovelAI official account",
      "email": "Email",
      "emailVerified": "Email verified",
      "accountCreatedAt": "Account created",
      "trialActivated": "Trial activated",
      "trialActionsLeft": "Trial actions left",
      "trialImagesLeft": "Trial images left",
      "banStatus": "Ban status",
      "banMessage": "Ban information",
      "subscription": "Subscription",
      "subscriptionActive": "Subscription active",
      "subscriptionExpires": "Subscription expires",
      "subscriptionGrace": "Subscription grace period",
      "subscriptionActiveStatus": "Subscription active",
      "notSubscribed": "Not subscribed",
      "tierValue": "Subscription tier {tier}",
      "anlasTotal": "Total Anlas",
      "anlasFixed": "Fixed Anlas",
      "anlasPurchased": "Purchased Anlas",
      "v5Percent": "V5 allowance",
      "v5Available": "V5 available",
      "v5Negative": "V5 allowance negative",
      "v5AvailableStatus": "Available",
      "v5UnavailableStatus": "Currently unavailable",
      "unavailable": "Unavailable",
      "yes": "Yes",
      "no": "No",
      "v5Reset": "V5 refresh",
      "refreshedAt": "Updated at",
      "refreshSoon": "Refreshing soon",
      "durationDaysHours": "in {days}d {hours}h",
      "durationHoursMinutes": "in {hours}h {minutes}m",
      "durationMinutes": "in {minutes}m",
      "staleAccount": "This account snapshot is out of date. Refresh before relying on its values.",
      "snapshotStale": "Data out of date",
      "accountSection": "Account details",
      "subscriptionAndQuota": "Subscription and allowance",
      "credentialSettings": "Account credentials",
      "accountNormal": "Account in good standing",
      "accountBanned": "Account banned",
      "trialStatus": "Trial status",
      "trialNotActivated": "Not activated",
      "trialRemaining": "{actions} actions · {images} images remaining",
      "anlasBreakdown": "Fixed {fixed} · Purchased {purchased}",
      "inGracePeriod": "Currently in the grace period",
      "notInGracePeriod": "Not in the grace period",
      "changePassword": "Change password",
      "currentPassword": "Current password",
      "newPassword": "New password",
      "backupConfirmed": "I have backed up my NovelAI keystore and understand this credential change.",
      "changeEmail": "Change email",
      "newEmail": "New email",
      "logoutFailed": "Log out failed. Please try again."
    },
    "accountInfo": "Account information",
    "closePageTitle": "Close page?",
    "closePageMessage": "You are about to close “{page}”. Unsaved data will be lost. Continue?",
    "confirmClose": "Close page",
    "unsavedWarning": "You may have unsaved work. Are you sure you want to leave?",
    "openDrawer": "Open sidebar",
    "closeDrawer": "Collapse sidebar",
    "themeToDark": "Switch to dark mode",
    "themeToLight": "Switch to light mode",
    "darkMode": "Dark mode",
    "lightMode": "Light mode",
    "account": "Account",
    "logout": "Log out"
  },
  "common": {
    "back": "Back",
    "retry": "Retry",
    "copied": "Copied",
    "copyFailed": "Could not copy. Select the text and copy it manually.",
    "close": "Close",
    "cancel": "Cancel",
    "refresh": "Refresh",
    "language": "Language",
    "custom": "Custom",
    "slow": "Slow",
    "fast": "Fast"
  },
  "pages": {
    "gallery": "Gallery",
    "aiPainting": "AI Painting",
    "imageTagging": "Image tagging",
    "localUpscaling": "Local upscaling",
    "artistReference": "Artist References",
    "imageReference": "Image References",
    "promptTemplate": "Prompt Templates",
    "settings": "Settings"
  },
  "tools": {
    "notFound": {
      "gameOver": "GAME OVER",
      "restartHint": "Click or press a key to restart",
      "status": "Site maintenance in progress",
      "description": "There is nothing here, but you can watch the countdown.",
      "hours": "HR",
      "minutes": "MIN",
      "seconds": "SEC",
      "challenge": "Up for a challenge?",
      "score": "Score:",
      "highScore": "High score:",
      "gameArea": "Snake game area",
      "controls": "Use the arrow keys or click the screen to change direction",
      "restart": "Restart",
      "start": "Start game",
      "backHome": "Back to home"
    }
  },
  "settings": {
    "showInspirationGallery": "Show inspiration gallery",

    "naming": {
      "seed": "Seed",
      "prompt32": "First 32 prompt characters",
      "localDateTime": "Date and time (current time zone)",
      "timestamp": "Timestamp",
      "random": "Random string"
    },
    "backgroundPresets": {
      "light": {
        "graphite": "Soft white",
        "sandstone": "Sandstone",
        "mist": "Morning mist",
        "sage": "Pale moss",
        "dusk": "Dusk",
        "rose": "Rose ash",
        "coffee": "Oat",
        "silver": "Silver"
      },
      "dark": {
        "graphite": "Graphite",
        "sandstone": "Smoked sand",
        "mist": "Night mist",
        "sage": "Deep moss",
        "dusk": "Twilight",
        "rose": "Smoked rose",
        "coffee": "Espresso",
        "silver": "Steel"
      }
    },
    "colorNames": {
      "mistBlue": "Mist blue",
      "graphite": "Graphite",
      "ocean": "Ocean",
      "celadon": "Celadon",
      "sage": "Sage",
      "olive": "Olive",
      "wheat": "Wheat",
      "clay": "Clay",
      "rose": "Dusty rose",
      "mauve": "Mauve",
      "indigo": "Indigo",
      "cocoa": "Cocoa"
    },
    "savedMessage": "Settings saved and applied.",
    "saveFailed": "Could not save settings. Check the local backend, folder permissions and browser storage, then retry.",
    "resetMessage": "Defaults are ready to save. Gallery storage and inspiration source are unchanged.",
    "title": "System settings",
    "intro": "Customize the application appearance and behavior. Settings are stored in this browser.",
    "themeSettings": "Theme settings",
    "themeMode": "Theme mode",
    "currentDark": "Dark mode is active",
    "currentLight": "Light mode is active",
    "switchToLight": "Switch to light",
    "switchToDark": "Switch to dark",
    "primaryColor": "Primary color",
    "customColorCode": "Custom color value",
    "invalidColor": "Enter a valid color value.",
    "colorExample": "For example, #58779A or rgb(88, 119, 154)",
    "colorPicker": "Use color picker",
    "backgroundSettings": "Background settings",
    "backgroundPreset": "Background presets",
    "customBackground": "Custom background colors",
    "mainBackground": "Main background",
    "mainBackgroundHint": "Main page background color",
    "cardBackground": "Card background",
    "cardBackgroundHint": "Card and panel background color",
    "drawerBackground": "Sidebar background",
    "drawerBackgroundHint": "Sidebar background color",
    "pageColors": "Page accent colors",
    "cyclePreset": "Cycle preset colors",
    "preview": "Theme preview",
    "previewTitle": "Preview title",
    "previewDescription": "This is a preview of the current theme settings.",
    "primaryButton": "Primary button",
    "secondaryButton": "Secondary button",
    "backgroundValue": "Main background: {value}",
    "paperValue": "Card background: {value}",
    "interfaceSettings": "Interface settings",
    "interfaceAnimation": "Interface animation",
    "animationDescription": "Control transitions and animation effects.",
    "transitionSpeed": "Transition speed: {speed}ms",
    "imageSettings": "Image settings",
    "downloadImage": "Image saving",
    "downloadSharedRule": "Saved images and manual downloads use these filename rules.",
    "autoDownload": "Automatically download in browser",
    "autoDownloadHint": "Download new results through your browser. Can be enabled together with gallery saving. Your browser controls the save location and may require permission for multiple downloads in a batch. Save settings after changing this switch.",
    "filenameRules": "Filename rules",
    "customPrefix": "Custom prefix",
    "prefixExample": "For example: AI_Image, portfolio, or draft",
    "downloadPreset": "Filename preset",
    "filenamePreview": "Filename preview",
    "reset": "Reset",
    "saved": "Saved",
    "saving": "Saving...",
    "save": "Save settings",
    "navigation": "Settings categories",
    "localSettings": "Saved to the local backend",
    "sidebarHint": "Preview colors instantly; save changes to local configuration.",
    "sections": {
      "appearance": {
        "title": "Appearance",
        "description": "Adjust the theme, page accent colors, and interface animation."
      },
      "pages": {
        "title": "Page colors",
        "description": "Customize each page’s navigation icon and tab accent. Save to apply."
      },
      "interface": {
        "title": "Animation",
        "description": "Adjust workspace animations and transition duration."
      },
      "gallery": {
        "title": "Gallery & saving",
        "description": "Manage the local output folder, inspiration sources, and filenames."
      }
    },
    "colorSchemes": "Color schemes",
    "currentScheme": "Current palette · {name}",
    "customizeScheme": "Customize this palette",
    "customizeHint": "Each preset includes an accent color. Fine-tune the colors for the current mode here.",
    "pickColor": "Choose {name}",
    "storageImmediate": "Storage and inspiration gallery changes apply immediately. Save other options using the footer.",
    "unsaved": "Unsaved changes",
    "upToDate": "Settings saved",
    "discard": "Discard",
    "darkDescription": "Designed for comfortable use in low light.",
    "lightDescription": "A bright, clear theme for daytime use.",
    "autoSaveToGallery": "Automatically save to generation gallery",
    "autoSaveToGalleryHint": "Save new results to the browser storage or local folder selected above. Can be enabled together with automatic downloads. Save settings after changing this switch.",
    "loadFailed": "Could not load local settings. Retry before saving."
  }
};

Object.assign(messages, {
  "tutorials": {
    "playbackSpeed": "Playback speed",
    "demoChapters": "Demo chapters",
    "seekingChapter": "Opening this chapter…",
    "openPage": "Open tutorials",
    "nav": {
      "painting": "Drawing",
      "promptEditor": "Prompt editor",
      "promptNotebook": "Prompt notebook",
      "drawingImages": "Images",
      "drawingJobs": "Generation and troubleshooting",
      "drawingWorks": "Work history"
    },
    "drawingPracticeIntro": "Use sample images and the real controls in a separate drawing practice.",
    "topics": {
      "imageDisplay": "Image display",
      "imageHistory": "Image history",
      "imageDrop": "Drag and import images",
      "imageAdjustment": "Image adjustment",
      "generationParameters": "Generation parameters and jobs",
      "generationErrors": "Errors and result recovery",
      "workHistory": "Work history and blueprint",
      "collapse": "Collapse and expand",
      "preview": "Preview",
      "translation": "Translation",
      "comments": "Comments",
      "weights": "Quick weights",
      "suggestions": "Tag suggestions",
      "random": "Random prompts",
      "notebook": "Save and use notes"
    },
    "guides": {
      "imageDisplay": "Image display guide",
      "imageHistory": "Image history guide",
      "imageDrop": "Drag and import images guide",
      "imageAdjustment": "Image adjustment guide",
      "generationParameters": "Generation parameters and jobs guide",
      "generationErrors": "Errors and result recovery guide",
      "workHistory": "Work history and blueprint guide",
      "collapse": "Collapse and expand guide",
      "preview": "Preview guide",
      "translation": "Translation guide",
      "comments": "Comments guide",
      "weights": "Quick weights guide",
      "suggestions": "Tag suggestion guide",
      "random": "Random prompt guide",
      "notebook": "Prompt notebook guide"
    },
    "sections": {
      "demo": "Demo",
      "tryIt": "Interactive example",
      "guide": "Try it in the workspace"
    },
    "contents": "Contents",
    "previous": "Previous",
    "next": "Next",
    "loading": "Loading the tutorial…",
    "loadFailed": "This tutorial didn’t load.",
    "retry": "Reload",
    "play": "Play demo",
    "pause": "Pause demo",
    "replay": "Play from the start",
    "goToStep": "Step {index}",
    "replayProgress": "Replay position",
    "fullscreen": "Full screen",
    "replayError": "The replay could not load. Start guided practice at the top of the article.",
    "guidedPractice": "Start guided practice",
    "sessionEnded": "Guided session ended",
    "stayInWorkspace": "Stay in the workspace",
    "startGuide": "Start guide",
    "startPractice": "Start practice",
    "returnToTutorial": "Back to tutorial",
    "returnToChangelog": "Back to changelog",
    "guideUnavailable": "This feature isn’t available with your sign-in method. Watch the demo on this page to see how it works.",
    "startSuggestions": "Start tag suggestion guide",
    "openPractice": "Go to practice",
    "practiceTitle": "Tag suggestion practice",
    "editorPractice": {
      "activePrompt": "Prompt used for generation: {prompt}",
      "exerciseModel": "Current practice model: {model}",
      "saveNote": "A note keeps a prompt, model and character positions together for your next drawing. Click Save on the prompt toolbar and give this V5 sample a new name.",
      "openNotebook": "Click the book icon to find the note you just saved.",
      "createGroup": "Create a group in the groups sidebar. On a phone, open the group list first.",
      "moveNote": "Use the note’s menu or Manage to move the note into the new group.",
      "filterNotes": "Select the new group and find the note you moved.",
      "copyCharacter": "Open the note details and click a copy button on a character card.",
      "exportNotes": "Return to the note list and click Export to download the sample JSON.",
      "importNotes": "Click Import and select the JSON file you just downloaded.",
      "applySameModel": "Keep Apply model off, choose Use on a note, and check the current practice model.",
      "applySavedModel": "Open the notebook again, turn Apply model on, and use a V5 note to see the model change.",
      "openRandom": "To vary the hair color on each generation, let your prompt draw from a list of tags. Click the dice on the prompt toolbar to build that list.",
      "enableRandom": "Turn on random prompts. During generation, a marker is replaced with a tag drawn from its category or collection.",
      "addCategory": "Add a category, give it a name, add at least two tags, and save the category.",
      "addCollection": "Open Collections, add a collection and include the category you just made.",
      "sampleRandom": "Generate an example for the collection to see the tags it draws.",
      "saveRandom": "Close the example and choose Save configuration to keep the collection in this practice.",
      "insertRandom": "Insert the collection marker, then close the configuration window.",
      "resolveRandom": "Use the draw button below to see what would replace the marker during generation.",
      "sampleButton": "Draw a sample prompt",
      "done": "Practice complete. Finish to restore your prompt and preferences.",
      "collapse": "Click the arrow on the prompt toolbar to collapse the prompt section.",
      "reopen": "Click the arrow again to reopen it. The sample prompt is still there.",
      "expandEditor": "Click the expand icon at the bottom right of the positive prompt field.",
      "applyEditor": "Choose Apply changes to return to the workspace and check the sample prompt.",
      "previewOff": "Open the gear menu and turn off preview to see the raw syntax.",
      "previewOn": "Turn preview back on and compare the weight, comment, and random markers.",
      "overlayPreview": "Use the expanded editor’s gear menu to toggle the overlay preview and compare the layouts.",
      "translationHint": "Hover over blue hair or red eyes and read the translation tooltip.",
      "translationTap": "Tap blue hair or red eyes and read the translation by the cursor.",
      "translationTab": "Open the Translation tab on the prompt toolbar.",
      "translate": "Type 蓝发，红瞳 in the source field and choose Translate to see the sample result.",
      "applyTranslation": "Choose Apply to positive to put the result into the sample prompt.",
      "commentButton": "Select red eyes and click Comment. Look for the commented text in the preview.",
      "uncommentButton": "With the whole comment selected, click Uncomment.",
      "commentKey": "Select red eyes and press Ctrl+/ to comment it.",
      "uncommentKey": "Keep the selection and press Ctrl+/ again to restore the text.",
      "wheelWeight": "Put the cursor inside blue hair in the regular prompt field. Hold Shift and scroll the mouse wheel.",
      "keyWeight": "With the cursor still in a tag, press Alt+↑ or Alt+↓ to change the weight again.",
      "weightButton": "Put the cursor in a tag and click W+ or W− to change its weight."
    },
    "practiceKeys": "Press ↓ or ↑ to select a suggestion, then Enter to insert it. Tab inserts the selected suggestion or the first one if none is selected.",
    "inserted": "Inserted {tag}",
    "practiceDefaults": "Use the prompt field below with the default search symbols. Your original prompt returns when you leave.",
    "exercises": {
      "english": {
        "title": "Search in English",
        "help": "Type “{query}”, then select blue_hair."
      },
      "pinyin": {
        "title": "Search with pinyin",
        "help": "Type “{query}” (the pinyin for blond hair), then select blonde_hair."
      },
      "root": {
        "title": "Browse top-level categories",
        "help": "Type “+” to list top-level categories, then choose clothing."
      },
      "children": {
        "title": "Browse subcategories",
        "help": "Choose bottoms from the “+服装+” suggestions to see the tags in that subcategory."
      },
      "within": {
        "title": "Insert a tag from the subcategory",
        "help": "Choose skirt from the “+服装+下装=” results."
      },
      "scoped": {
        "title": "Search within a category",
        "help": "Type “{query}” to find Genshin Impact tags whose English or pinyin starts with fu, then choose Furina."
      },
      "fuzzy": {
        "title": "Find a misspelled tag",
        "help": "Type “{query}” and look at how the closest matches are ranked. Choose blue_hair."
      },
      "regex": {
        "title": "Filter with a regular expression",
        "help": "Type “{query}”. The =* prefix starts regex search. ^blue_ matches tags starting with blue_. Choose any result."
      }
    }
  }
});
Object.assign(messages.pages, {
  "tutorials": "Tutorials"
});
Object.assign(messages.settings.sections, {
  "prompt": {
    "title": "Prompt editor",
    "description": "Configure tag suggestions, translation, weighting, and automatic formatting in the inline and expanded editors."
  }
});
Object.assign(messages.settings, {
  "prompt": {
    "suggestions": "Tag suggestions",
    "suggestionsEnabled": "Show tag suggestions as you type",
    "suggestionLimit": "Maximum suggestions",
    "suggestionSettings": "Tag suggestion settings",
    "configureSuggestions": "Configure tag suggestions",
    "suggestionLayout": "Suggestion layout",
    "suggestionLayoutOptions": {
      "flow": "Wrap to fit",
      "columns": "Equal-width columns"
    },
    "suggestionTextLayout": "Text inside each tag",
    "suggestionTextLayoutOptions": {
      "horizontal": "Side by side",
      "vertical": "Stacked"
    },
    "suggestionSyntax": "Enable tag search syntax",
    "syntaxSymbols": "Search symbols",
    "symbols": {
      "category": "Category path",
      "exact": "Category search",
      "fuzzy": "Fuzzy match",
      "regex": "Regex"
    },
    "invalidSymbols": "Use a different single symbol for each field. Commas, colons, square brackets, braces and slashes are reserved.",
    "expandedPreview": "Tag preview in the expanded editor",
    "expandedPreviewOptions": {
      "auto": "Automatic by screen width",
      "on": "Always show",
      "off": "Always hide"
    },
    "preview": "Preview and translation",
    "inlinePreview": "Preview prompts in the inline editor",
    "overlayPreview": "Overlay previews in the expanded editor",
    "translationEnabled": "Show tag meanings and translations",
    "translationUnderline": "Underline tags with translations",
    "translationTarget": "Translation language",
    "weighting": "Prompt weighting",
    "weightShortcutsEnabled": "Enable weight shortcuts",
    "keepWeightSelection": "Keep the selection after weighting",
    "defaultWeightMode": "Default syntax for new weights",
    "weightStep": "Numeric weight step",
    "formatting": "Automatic formatting",
    "autoFormat": "Format prompts while editing",
    "normalizeCommas": "Normalize commas and tag spacing",
    "replaceUnderscores": "Replace underscores in ordinary tags",
    "trailingComma": "Trailing comma",
    "trailingOptions": {
      "preserve": "Keep as written",
      "remove": "Remove trailing comma",
      "append": "Add trailing comma"
    },
    "help": {
      "suggestionsEnabled": "See matching suggestions when typing positive or negative tags. Use the arrow keys to browse and Enter or Tab to insert one.",
      "suggestionLimit": "Limit how many matching tags appear at once. Use a smaller value for a shorter menu or a larger value to see more matches.",
      "suggestionLayout": "Wrap tags at their natural widths or align them in equal-width columns.",
      "suggestionTextLayout": "Choose how the English tag and its Chinese translation appear inside each suggestion.",
      "suggestionSyntax": "Limit searches to a category or match by similarity or regular expression. Basic search accepts English, Chinese and pinyin.",
      "syntaxSymbols": "Type {category} for categories, {category}服装{category} for clothing subcategories, or {category}原神{exact}fu to search Genshin Impact for fu. Use {fuzzy}fu for fuzzy matches or {exact}{regex}^fu for tags starting with fu.",
      "expandedPreview": "See tags, weights, and translations alongside your prompt. The automatic setting shows the preview on wide screens and leaves more space for typing on narrow screens.",
      "inlinePreview": "Highlight weights, random prompt syntax, and comments directly in the regular prompt fields.",
      "overlayPreview": "When the expanded editor preview is open, show highlighting and translations over the text to make more room for editing.",
      "translationEnabled": "Hover or tap a recognized tag to see its meaning. The original text and prompts sent for generation remain as written.",
      "translationUnderline": "Underline tags that have a translation so you can tell which ones have a definition available.",
      "translationTarget": "Choose the language used for tag meanings. Automatic follows the interface language.",
      "weightShortcutsEnabled": "In a prompt field, use Alt with the up and down arrows or hold Shift while scrolling to adjust the tag under the cursor or the selected text.",
      "keepWeightSelection": "Keep selected text highlighted after a weight adjustment so you can repeat it. Turn this off to place the caret at the end.",
      "defaultWeightMode": "Choose the syntax used the first time you weight a tag. Existing numeric or bracketed weights keep their syntax.",
      "weightStep": "Choose how much each numeric weight adjustment changes the value. A 0.05 step changes 1.00 to 1.05. Bracketed weights still change by one layer.",
      "autoFormat": "Format pasted text on insertion and tidy the full prompt when you leave an edited field. Comments, placeholders and escaped text are preserved.",
      "normalizeCommas": "Convert full-width commas and put one space between tags on the same line, preserving line breaks.",
      "replaceUnderscores": "For example, turn long_hair into long hair. URLs, namespaced tags, and random placeholders keep their syntax.",
      "trailingComma": "Choose how to handle the last comma when you finish editing. Adding one makes it easier to append another tag."
    }
  }
});
Object.assign(messages.settings.naming, {
  "custom": "Custom template"
});

Object.assign(messages, {
  "changelog": {
    "guide": {
      "title": "New feature guide",
      "start": "Start guide",
      "next": "Next",
      "finish": "Finish guide",
      "exit": "Exit guide",
      "captchaPreview": "Local CAPTCHA preview",
      "exampleNote": "Moonlit garden (guide example)",
      "character": "Lantern bearer",
      "panelTitle": "Open generation parameters",
      "panelHelp": "Tap the highlighted panel button. The prompt tools are at the top of the panel.",
      "expandSectionTitle": "Expand the prompt section",
      "expandSectionHelp": "The prompt section is collapsed. Click the highlighted arrow to show the prompt field.",
      "collapseTitle": "Collapse the prompt section",
      "collapseHelp": "Click the arrow. Only the tab bar and tool buttons stay visible, and your prompt is kept.",
      "reopenTitle": "Expand it again",
      "reopenHelp": "This browser remembers the collapsed state for next time. Click the arrow to expand, or switch to another tab while collapsed.",
      "expandEditorTitle": "Open the large editor",
      "expandEditorHelp": "Click the highlighted expand icon at the bottom right of the field to edit the positive prompt in a large window.",
      "editorToolbarTitle": "Editing toolbar",
      "editorToolbarHelp": "Adjust weights (W+ / W−), comment or uncomment text, and insert random prompts. Token counts and the cursor position appear below.",
      "editorApplyTitle": "Keep or discard changes",
      "editorApplyHelp": "Apply changes copies the text back to the prompt field. Cancel, or closing the window, discards this edit.",
      "promptInputTitle": "Preview in the prompt field",
      "promptInputHelp": "With preview on, raised weights have a red background, lowered weights blue, comments are gray and struck through, and random prompts have a dashed underline. Only the display changes, never the text.",
      "previewToggleTitle": "Turn preview on or off",
      "previewToggleHelp": "Show preview controls the highlighting in the regular prompt field. The large editor has its own gear menu for side-by-side or overlay preview.",
      "translationTabTitle": "Translate tab",
      "translationTabHelp": "Click the highlighted Translate tab to turn a description into a prompt.",
      "translateSourceTitle": "Translate a description",
      "translateSourceHelp": "Enter text under Source text and choose Translate. Apply to positive prompt replaces the whole positive prompt with the result.",
      "translationSettingsTitle": "Tag meanings",
      "translationSettingsHelp": "With Enable translation on, meanings are looked up about 3 seconds after you stop typing. Click a tag or move the cursor into it to see one. Set the underline and target language below.",
      "commentButtonsTitle": "Comment and uncomment",
      "commentButtonsHelp": "Select some text first. The left button wraps the tags it touches in /* */. The right button removes the markers from comments inside the selection. Comments are never sent for generation.",
      "editorPreviewTitle": "Check the preview",
      "editorPreviewHelp": "Comments appear gray and struck through, and weights have a red or blue background. Choose Next when you’re done.",
      "weightButtonsTitle": "Adjust weights",
      "weightButtonsHelp": "Put the cursor inside a tag or select text, then choose W+ to raise or W− to lower its weight. You can also press Alt + ↑ / ↓ or hold Shift and scroll.",
      "randomTitle": "Open random prompts",
      "randomHelp": "Click the highlighted dice icon on the prompt toolbar. The icon turns the theme color when random prompts are on.",
      "randomEnableTitle": "Turn on random prompts",
      "randomEnableHelp": "When on, each generation replaces the random markers in your prompt with drawn entries. Choose Save settings to keep changes.",
      "randomTabsTitle": "Categories and collections",
      "randomTabsHelp": "Categories hold the entries to draw from, Collections combine several categories, and How to use lists the syntax. Each category and collection has an Insert button.",
      "randomActionsTitle": "Save the settings",
      "randomActionsHelp": "Choose Save settings to keep your changes, or Cancel to close the window.",
      "notebookTitle": "Open the prompt notebook",
      "notebookHelp": "Click the highlighted book icon on the prompt toolbar.",
      "noteTitle": "View a character note",
      "noteHelp": "Click the highlighted eye to view the note. A read-only example is available when there are no notes with characters in view.",
      "charactersTitle": "Explore the character card",
      "charactersHelp": "The card shows the character prompts and position. Use the copy icons for either prompt, then choose Next.",
      "closePreviewTitle": "Return to the notebook",
      "closePreviewHelp": "Click the highlighted close button at the top right of the note.",
      "closeNotebookTitle": "Return to the drawing workspace",
      "closeNotebookHelp": "The switch at the bottom controls whether applying a note changes the model. Click Close to finish.",
      "gearTitle": "Open prompt settings",
      "gearHelp": "Click the gear on the prompt toolbar.",
      "configureTitle": "Open tag suggestion settings",
      "configureHelp": "Choose “Configure tag suggestions” in the menu.",
      "enableSuggestionsTitle": "Turn on tag suggestions",
      "enableSuggestionsHelp": "Turn suggestions on to see matching tags as you type. You can also toggle them from the gear menu.",
      "appearanceTitle": "Arrange the suggestions",
      "appearanceHelp": "Set the result limit, choose wrapping rows or equal-width columns, and arrange translations side by side or stacked.",
      "syntaxTitle": "Configure search syntax",
      "syntaxHelp": "Turn search syntax on or off, or change the symbols for categories, scoped search, fuzzy matching and regular expressions. Each symbol must be different.",
      "closeSettingsTitle": "Continue to the practice",
      "closeSettingsHelp": "Save any changes you want to keep, or choose Cancel to go straight to practice.",
      "waitingTitle": "Finding the drawing control",
      "waitingHelp": "Waiting for the control to appear. Return to the generation workspace if another window is open. For instruction editing, switch to a drawing model that supports prompt tags."
    }
  }
});
Object.assign(messages.settings, {
  "interface": {
    "display": "Image preview",
    "history": "Generation history",
    "expandedImageShortcuts": "Show tool shortcuts directly",
    "displayImageDrag": "Hold and drag out preview images",
    "historyImageDrag": "Hold and drag out history images",
    "centerNewGeneration": "Fit and center each new generation",
    "lockedGestureNavigation": "Scroll or swipe to browse while locked",
    "transparencyBackground": "Transparent image background",
    "customColor": "Custom background color",
    "backgrounds": {
      "none": "No fill",
      "checkerboard": "Theme-matched checkerboard",
      "white": "White",
      "gray": "Gray",
      "green": "Green",
      "red": "Red",
      "blue": "Blue",
      "custom": "Custom color"
    },
    "privacyMode": "Privacy mode",
    "privacyScope": "Blurred areas",
    "privacyReveal": "Reveal images",
    "privacyScopeOptions": {
      "both": "Preview and history",
      "display": "Preview only",
      "history": "History only"
    },
    "privacyRevealOptions": {
      "hold": "Press and hold",
      "hover": "While hovering or touching",
      "toggle": "Click or tap to toggle"
    },
    "bottomBar": "Bottom bar shortcuts",
    "showAdjustmentEntry": "Image adjustments",
    "showGalleryEntry": "Generation gallery",
    "historyFollowSelection": "Keep the selected image in view",
    "historyImageFit": "Expanded history thumbnail layout",
    "fitOptions": {
      "contain": "Fit the entire image",
      "cover": "Fill the thumbnail"
    },
    "privacy": "Privacy",
    "help": {
      "expandedImageShortcuts": "Show the actions from the Use for and Send to menus directly in the floating toolbar so you can reach them in one step.",
      "displayImageDrag": "Press and hold the preview image, then drag it into an app or page that accepts image drops. Turn this off to drag the image to pan immediately.",
      "historyImageDrag": "Press and hold a thumbnail in the history strip or expanded gallery, then drag it out using the current preview export settings.",
      "centerNewGeneration": "After each generation, reset zoom and pan so the entire new image is centered. Turn this off to keep your view between generations.",
      "lockedGestureNavigation": "While the canvas is locked, use the scroll wheel or swipe with one finger to browse adjacent images. Unlock to return to zooming and panning.",
      "transparencyBackground": "Changes what you see behind transparent pixels. No fill shows the workspace through the image. Downloads and exports retain the original transparency.",
      "customColor": "Choose a color to display under transparent pixels. The color is a preview setting.",
      "historyFollowSelection": "When you browse images, the history list automatically scrolls the active thumbnail into view. Turn this off to keep the list at its current scroll position.",
      "historyImageFit": "Choose whether the expanded gallery shows the complete image or crops the edges to fill a uniform tile. This only affects thumbnails.",
      "privacyMode": "Blur images in your chosen areas. Use the reveal gesture below to see an image when needed.",
      "privacyScope": "Blur the preview, history thumbnails, or both.",
      "privacyReveal": "Holding or hovering reveals an image for the duration of the gesture. In click-to-toggle mode, tap again to blur it.",
      "showAdjustmentEntry": "Keep an image adjustment button below the history strip so you can edit the current image or upload your own.",
      "showGalleryEntry": "Show a shortcut below the history strip for browsing images you have saved to the generation gallery."
    }
  }
});
Object.assign(messages.settings, {
  "shortcuts": {
    "canvas": "Preview and history",
    "unassigned": "Unassigned",
    "recording": "Press a new key…",
    "conflict": "This shortcut is already assigned to {action}.",
    "clearShortcut": "Clear shortcut for {action}",
    "previousImageShortcut": "Previous image",
    "nextImageShortcut": "Next image",
    "deleteImageShortcut": "Delete current history image",
    "resetViewShortcut": "Fit and center the image",
    "adjustImageShortcut": "Open or close image adjustments",
    "privacyShortcut": "Toggle privacy mode",
    "restore": "Restore default shortcuts",
    "help": {
      "previousImageShortcut": "Browse to the previous image in history. At the start of the list, continue from the end.",
      "nextImageShortcut": "Browse to the next image in history. At the end of the list, continue from the start.",
      "deleteImageShortcut": "Remove the selected image from the current generation history. A separately saved gallery copy remains available.",
      "resetViewShortcut": "Reset the current preview’s zoom and position to center the entire image in the workspace.",
      "adjustImageShortcut": "Enter image adjustments or return to the generation preview. You can open adjustments on an empty canvas and upload an image.",
      "privacyShortcut": "Quickly toggle privacy using the blur scope and reveal gesture selected under Interface.",
      "restore": "Restore the default bindings for this page. Save to apply the changes."
    }
  }
});
Object.assign(messages.settings.sections, {
  "shortcuts": {
    "title": "Keyboard shortcuts",
    "description": "Focus a shortcut field, then press a key or key combination. Each binding can be assigned to one action. Save to apply your changes."
  }
});

export default messages;
