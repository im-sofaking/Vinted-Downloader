// popup.js
console.log("Popup loaded");

// Global variables for scraping control
let isScraping = false;
let stopRequested = false;
let currentProgress = {
  completed: 0,
  failed: 0,
  total: 0,
  current: 0
};

let statusInterval = null;


// Get DOM elements
const scrapeItemBtn = document.getElementById('scrapeThisPage');
const scrapeProfileBtn = document.getElementById('scrapeProfile');
const stopScrapingBtn = document.getElementById('stopScraping');
const statusText = document.getElementById('statusText');
const progressContainer = document.querySelector('.progress-container');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const statsDisplay = document.getElementById('statsDisplay');
const completedCount = document.getElementById('completedCount');
const currentItemDisplay = document.getElementById('currentItem');
const failedCount = document.getElementById('failedCount');


function isItemPage(url) {
  return url.includes('/items/');
}

function isProfilePage(url) {
  return url.includes('/member/');
}

function updateButtonsForCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0] || !tabs[0].url) return;

    const url = tabs[0].url;

    // Default: disable everything
    scrapeItemBtn.disabled = true;
    scrapeProfileBtn.disabled = true;

    // If scraping is active, buttons must stay disabled
    if (isScraping) return;

    // ITEM PAGE
    if (isItemPage(url)) {
      scrapeItemBtn.disabled = false;
      scrapeProfileBtn.disabled = true;
      return;
    }

    // PROFILE PAGE
    if (isProfilePage(url)) {
      scrapeProfileBtn.disabled = false;
      scrapeItemBtn.disabled = true;
      return;
    }

    // OTHER PAGE → both disabled
  });
}


function syncScrapingStatus() {
  chrome.runtime.sendMessage({ action: 'getScrapingStatus' }, function(response) {
    if (!response) return;

    // SCRAPING ACTIVE
    if (response.isScraping) {
      isScraping = true;

      stopScrapingBtn.style.display = 'flex';
      progressContainer.style.display = 'block';
      statsDisplay.style.display = 'flex';

      scrapeItemBtn.disabled = true;
      scrapeProfileBtn.disabled = true;

      if (response.progress) {
        updateProgress(
          response.progress.completed,
          response.progress.failed,
          response.progress.total,
          response.progress.current
        );
      }

      statusText.innerHTML =
        '<span class="status-icon">🔄</span> Scraping in progress...';
    }

    // SCRAPING STOPPED / FINISHED
    else {
      if (isScraping) {
        statusText.innerHTML =
          '<span class="status-icon">⏹️</span> Scraping stopped or completed.';
      }

      resetUI();
    }
    updateButtonsForCurrentPage();
  });
}



// Single item button
scrapeItemBtn.addEventListener('click', function() {

  if (scrapeItemBtn.disabled) return;

  if (isScraping) {
    alert("Please stop the current scraping process first!");
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;

    const url = tabs[0].url;

    // ❌ User is on an item page
    if (!isItemPage(url)) {
      statusText.innerHTML =
        '<span class="status-icon">⚠️</span> You are not on an article page.<br>' +
        'Please visit the <strong>profile page</strong> to download an entire profile.';
      return;
    }

    // ❌ Not a profile page at all
    if (isProfilePage(url)) {
      statusText.innerHTML =
        '<span class="status-icon">❌</span> This is a Vinted profile page.';
      return;
    }

    // ✅ Correct page → start scraping
    startScraping('item');
  });
});

// Profile button  
scrapeProfileBtn.addEventListener('click', function() {

  if (scrapeProfileBtn.disabled) return;

  if (isScraping) {
    alert("A scraping process is already running!");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;

    const url = tabs[0].url;

    // ❌ User is on an item page
    if (isItemPage(url)) {
      statusText.innerHTML =
        '<span class="status-icon">⚠️</span> You are on an article page.<br>' +
        'Please visit the <strong>profile page</strong> to scrape an entire profile.';
      return;
    }

    // ❌ Not a profile page at all
    if (!isProfilePage(url)) {
      statusText.innerHTML =
        '<span class="status-icon">❌</span> This is not a Vinted profile page.';
      return;
    }

    // ✅ Correct page → start scraping
    startScraping('profile');
  });
});


// Stop button
stopScrapingBtn.addEventListener('click', function() {
  stopScraping();
});

function startScraping(type) {
  isScraping = true;
  stopRequested = false;
  
  // Reset progress
  currentProgress = {
    completed: 0,
    failed: 0,
    total: 0,
    current: 0
  };
  
  // Update UI for scraping mode
  if (type === 'profile') {
    // Show stop button and progress for profile scraping
    stopScrapingBtn.style.display = 'flex';
    progressContainer.style.display = 'block';
    statsDisplay.style.display = 'flex';
    scrapeItemBtn.disabled = true;
    scrapeProfileBtn.disabled = true;
    
    statusText.innerHTML = '<span class="status-icon">🔄</span> Starting profile scrape...';
    updateProgress(0, 0, 0, 0);
  } else {
    // For single item, simpler UI
    statusText.innerHTML = '<span class="status-icon">🔄</span> Starting item scrape...';
  }
  
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs[0] || !tabs[0].url.includes('vinted.')) {
      statusText.innerHTML = '<span class="status-icon">❌</span> Please open a Vinted page first!';
      resetUI();
      return;
    }
    
    // Send message to start scraping
    chrome.runtime.sendMessage({
      action: type === 'item' ? 'scrapeItem' : 'scrapeProfile',
      tabId: tabs[0].id
    }, function(response) {
      if (chrome.runtime.lastError) {
        resetUI();
      } else {
        if (type === 'item') {
          statusText.innerHTML = '<span class="status-icon">✅</span> Item scrape started! Check alerts and downloads.';
          // Auto-close for single item
          setTimeout(() => window.close(), 2000);
        } else {
          statusText.innerHTML = '<span class="status-icon">✅</span> Profile scrape started!';
          // Don't auto-close for profile scraping
        }
      }
    });
  });
  
  // Listen for progress updates from service worker
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'scrapingProgress') {
      updateProgress(
        message.completed, 
        message.failed, 
        message.total, 
        message.current
      );
    } else if (message.action === 'scrapingComplete') {
      statusText.innerHTML = `<span class="status-icon">✅</span> Scraping complete! ${message.completed} items downloaded.`;
      resetUI();
    } else if (message.action === 'scrapingStopped') {
      statusText.innerHTML = `<span class="status-icon">⏹️</span> Scraping stopped. ${message.completed} items completed.`;
      resetUI();
    }
  });
}

function stopScraping() {
  if (!isScraping) return;
  
  stopRequested = true;
  statusText.innerHTML = '<span class="status-icon">⏹️</span> Stopping... Please wait.';
  stopScrapingBtn.disabled = true;
  
  // Send stop message to service worker
  chrome.runtime.sendMessage({
    action: 'stopScraping'
  }, function(response) {
    console.log("Stop request sent");
  });
}

function updateProgress(completed, failed, total, current) {
  currentProgress = { completed, failed, total, current };
  
  // Update counts
  completedCount.textContent = completed;
  failedCount.textContent = failed;
  currentItemDisplay.textContent = current > 0 ? `${current}/${total}` : '-';
  
  // Update progress bar
  if (total > 0) {
    const percentage = Math.round((completed / total) * 100);
    progressBar.style.width = percentage + '%';
    progressText.textContent = `Progress: ${completed}/${total} items (${percentage}%)`;
  }
  
  // Update status text
  if (current > 0) {
    statusText.innerHTML = `<span class="status-icon">🔄</span> Downloading item ${current} of ${total}...`;
  }
}

function resetUI() {
  isScraping = false;
  stopRequested = false;
  
  // Hide stop button and re-enable scrape buttons
  stopScrapingBtn.style.display = 'none';
  stopScrapingBtn.disabled = false;
  scrapeItemBtn.disabled = false;
  scrapeProfileBtn.disabled = false;
  
  // Hide progress for single item mode
  progressContainer.style.display = 'none';
  statsDisplay.style.display = 'none';

  updateButtonsForCurrentPage();
}

// Check current page and update UI
chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
  if (!tabs[0] || !tabs[0].url.includes('vinted.')) return;

  const url = tabs[0].url;

  // ITEM PAGE
  if (url.includes('/items/')) {
    statusText.innerHTML =
      '<span class="status-icon">📦</span> You are on an item page.<br>' +
      'Visit the seller <strong>profile</strong> to download all items.';

    scrapeProfileBtn.disabled = true;
    scrapeItemBtn.disabled = false;
  }

  // PROFILE PAGE
  else if (url.includes('/member/')) {
    statusText.innerHTML =
      '<span class="status-icon">👤</span> Ready to download this profile!';

    scrapeProfileBtn.disabled = false;
    scrapeItemBtn.disabled = true;
  }

  // OTHER VINTED PAGE
  else {
    statusText.innerHTML =
      '<span class="status-icon">ℹ️</span> Navigate to an item or profile page.';

    scrapeProfileBtn.disabled = true;
  }
});


// Check if scraping is already in progress when popup opens
chrome.runtime.sendMessage({action: 'getScrapingStatus'}, function(response) {
  if (response && response.isScraping) {
    isScraping = true;
    stopScrapingBtn.style.display = 'flex';
    progressContainer.style.display = 'block';
    statsDisplay.style.display = 'flex';
    scrapeItemBtn.disabled = true;
    scrapeProfileBtn.disabled = true;
    
    if (response.progress) {
      updateProgress(
        response.progress.completed,
        response.progress.failed,
        response.progress.total,
        response.progress.current
      );
    }
    
    statusText.innerHTML = '<span class="status-icon">🔄</span> Scraping in progress...';
  }
});

// Start polling scraping status every 1 second
statusInterval = setInterval(syncScrapingStatus, 1000);

// Run once immediately
syncScrapingStatus();

window.addEventListener('unload', function() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
});