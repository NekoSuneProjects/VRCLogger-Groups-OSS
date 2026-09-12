document.addEventListener("DOMContentLoaded", function () {
    const tabs = [
        { id: "main-log", label: "Main Log", content: "mainLogContent"  },
        { id: "joining-leaving", label: "Joining/Leaving", content: "joiningLeavingContent"  },
        { id: "detect-known-blacklist", label: "Detect Known Blacklist", content: "detectKnownBlacklistContent"  },
        { id: "avatar-switch-blacklist", label: "Avatar Switch Blacklist", content: "avatarSwitchContent"  },
        { id: "assets-blacklist", label: "Assets Logger", content: "assetsContent"  },
        { id: "avatars-seen", label: "Avatars Seen", content: "avatarsSeenContent"  },
        { id: "moderation-logs", label: "Moderation Logs", content: "moderationLogsContent" },
        { id: "settings", label: "Settings" }
    ];

    const tabList = document.getElementById("logTabs");
    const tabContent = document.getElementById("logTabContent");

    tabs.forEach((tab, index) => {
        const activeClass = index === 0 ? "active" : "";
        
        tabList.innerHTML += `
            <li class="nav-item">
                <a class="nav-link ${activeClass}" id="${tab.id}-tab" data-bs-toggle="tab" href="#${tab.id}">
                    ${tab.label}
                </a>
            </li>`;

        let content = `<div class="logsDiv" id="${tab.content}"></div>`;

        // Check if this is the "Settings" tab and insert predefined content
        if (tab.id === "settings") {
        content = `
            <div class="row">
      <!-- Warning Modal -->
      <div
         class="modal fade"
         id="warningModal"
         tabindex="-1"
         aria-labelledby="warningModalLabel"
         aria-hidden="true"
         >
         <div class="modal-dialog">
            <div class="modal-content bg-dark text-white">
               <div class="modal-header">
                  <h5 class="modal-title" id="warningModalLabel">
                     Warning
                  </h5>
                  <button
                     type="button"
                     class="btn-close btn-close-white"
                     data-bs-dismiss="modal"
                     aria-label="Close"
                     ></button>
               </div>
               <div class="modal-body" id="warningModalBody">
                  <!-- Warning message will be inserted here -->
               </div>
               <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                  Close
                  </button>
               </div>
            </div>
         </div>
      </div>
      <!-- Safety Toggle Options -->
      <div class="col-md-6 mb-4">
         <div class="card bg-dark text-white">
            <div class="card-header">
               Safety Toggle Options
            </div>
            <div class="card-body">
               <div id="safetytoggleOptions"></div>
            </div>
         </div>
      </div>
      <!-- Toggle Options -->
      <div class="col-md-6 mb-4">
         <div class="card bg-dark text-white">
            <div class="card-header">Toggle Options</div>
            <div class="card-body">
               <div id="toggleOptions"></div>
            </div>
         </div>
      </div>
      <!-- VRC Logger API Setup -->
      <div class="col-md-6 mb-4">
         <div class="card bg-dark text-white">
            <div class="card-header">VRC Logger API</div>
            <div class="card-body">
               <div id="apikeysOptions"></div>
            </div>
            <div class="card-header">Save Options</div>
            <div class="card-body">
               <form id="debugSettingsForm">
                  <button type="button" class="btn btn-success" onclick="saveConfig()">
                  Save Settings
                  </button>
               </form>
            </div>
         </div>
      </div>
      <div class="col-md-6 mb-4">
         <div class="card bg-dark text-white">
            <div class="card-header">OBS Overlay</div>
            <div class="card-body">
               <div id="overlayUrl" class="small text-white-50"></div>
            </div>
         </div>
      </div>
   </div>
        `;
        }

        tabContent.innerHTML += `
            <div class="tab-pane fade show ${activeClass}" id="${tab.id}">
                ${content}
            </div>`;
    });
    // Initialize the page
    init();
});
