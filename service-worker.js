// service-worker.js - WITH PROFILE SCRAPING
console.log("Vinted Scraper: Service worker started");

// Add at the TOP of service-worker.js (after console.log)
let scrapingActive = false;
let scrapingStopped = false;
let currentProfileData = null;
let progressInfo = {
  completed: 0,
  failed: 0,
  total: 0,
  current: 0
};

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'scrapeItem') {
    console.log("Starting scrape for tab:", message.tabId);
    
    chrome.scripting.executeScript({
      target: {tabId: message.tabId},
      func: scrapeVintedItem
    }, function(results) {
      if (chrome.runtime.lastError) {
        console.error("Script error:", chrome.runtime.lastError);
        return;
      }
      
      if (results && results[0] && results[0].result) {
        var itemData = results[0].result;
        console.log("Scraped data:", itemData.title, "-", itemData.images.length, "images");
        
        // Download everything using Chrome API
        downloadAllFiles(itemData);
      }
    });
  }
  
if (message.action === 'scrapeProfile') {
  if (scrapingActive) {
    console.log("Scraping already in progress!");
    return;
  }

  scrapingActive = true;
  scrapingStopped = false;

  console.log("Starting PROFILE scrape for tab:", message.tabId);
  
  // Update status in popup
  chrome.runtime.sendMessage({
    action: 'scrapingProgress',
    completed: 0,
    failed: 0,
    total: 0,
    current: 0
  });
  
  // Inject the extractProfileInfo function and execute it
  chrome.scripting.executeScript({
    target: {tabId: message.tabId},
    func: function() {
      // This function will run in the page context
      console.log("==== EXTRACTING PROFILE INFO ====");
      
      // 1. Get username
      var username = '';
      var usernameEl = document.querySelector("[data-testid='profile-username'], h1");
      if (usernameEl) {
        username = usernameEl.innerText.trim();
        console.log("✅ Username found:", username);
      } else {
        // Fallback: extract from URL
        var path = window.location.pathname.split('/');
        username = path[path.length - 1] || 'vinted_user';
        console.log("ℹ️ Username from URL:", username);
      }

      // 2. Get total item count from the closet header
      var totalItems = 0;
      try {
        var closetHeader = document.querySelector("h2.web_ui__Text__text.web_ui__Text__title.web_ui__Text__left");
        if (closetHeader) {
          var closetText = closetHeader.textContent.trim();
          var match = closetText.match(/(\d+)/);
          if (match) {
            totalItems = parseInt(match[1]);
            console.log("📊 Total items in closet:", totalItems);
          }
        }
      } catch (e) {
        console.log("ℹ️ Could not get total item count:", e);
      }

      // 3. Function to scroll and load all items
      function scrollToLoadAllItems() {
        return new Promise((resolve) => {
          console.log("🔄 Starting to scroll to load all items...");
          
          var scrolls = 0;
          var maxScrolls = 30; // Fixed number of scrolls
          var lastCount = 0;
          var sameCount = 0;
          
          function scrollStep() {
            if (scrolls >= maxScrolls || sameCount >= 3) {
              console.log(`✅ Finished scrolling after ${scrolls} attempts`);
              resolve();
              return;
            }
            
            // Scroll to bottom
            window.scrollTo(0, document.body.scrollHeight);
            
            // Wait for content to load
            setTimeout(function() {
              // Count current items
              var loadedItems = document.querySelectorAll('a.new-item-box__overlay[href*="/items/"]').length;
              console.log(`📊 Scroll ${scrolls + 1}/${maxScrolls}: Loaded ${loadedItems} items`);
              
              if (loadedItems === lastCount) {
                sameCount++;
              } else {
                sameCount = 0;
                lastCount = loadedItems;
              }
              
              scrolls++;
              
              // Check if we've loaded all expected items
              if (totalItems > 0 && loadedItems >= totalItems) {
                console.log(`✅ Loaded all ${totalItems} items!`);
                resolve();
                return;
              }
              
              // Continue scrolling
              setTimeout(scrollStep, 1500);
            }, 2000);
          }
          
          scrollStep();
        });
      }

      // Execute scrolling and return profile data
      return scrollToLoadAllItems().then(function() {
        return new Promise((resolve) => {
          // Get all item URLs - FIXED SELECTOR
          var itemUrls = [];
          
          // Try multiple selectors to get items
          var selectors = [
            'a.new-item-box__overlay[href*="/items/"]',
            'a[href*="/items/"]',
            'div[data-testid*="item"] a[href*="/items/"]'
          ];
          
          var allLinks = [];
          
          // Try each selector
          selectors.forEach(function(selector) {
            var links = document.querySelectorAll(selector);
            console.log(`Selector "${selector}": Found ${links.length} links`);
            
            for (var i = 0; i < links.length; i++) {
              var href = links[i].getAttribute('href');
              if (href && href.includes('/items/')) {
                // Clean the URL
                var cleanUrl = href.split('?')[0];
                if (cleanUrl.match(/\/items\/\d+/)) {
                  // Make absolute URL
                  var fullUrl = cleanUrl.startsWith('http') ? cleanUrl : 'https://www.vinted.it' + cleanUrl;
                  
                  // Check if it's a valid item URL (not a favorites or other page)
                  if (fullUrl.includes('/items/') && !fullUrl.includes('/items/new') && 
                      !fullUrl.includes('/items/favorites') && !itemUrls.includes(fullUrl)) {
                    itemUrls.push(fullUrl);
                  }
                }
              }
            }
          });
          
          console.log("✅ After filtering:", itemUrls.length, "unique item URLs found");
          
          // If we have a totalItems count, compare
          if (totalItems > 0 && itemUrls.length !== totalItems) {
            console.warn(`⚠️ Warning: Found ${itemUrls.length} items, expected ${totalItems}`);
            
            // Try to get more accurate count by checking visible items
            var visibleItems = document.querySelectorAll('div[data-testid*="item"], div[class*="item-box"], div[class*="new-item-box"]');
            console.log("Visible item containers:", visibleItems.length);
          }
          
          // Return profile data
          var profileData = {
            username: username,
            itemUrls: itemUrls,
            profileUrl: window.location.href,
            scrapedAt: new Date().toISOString(),
            totalItems: totalItems
          };
          
          // Show confirmation
          var alertMessage = "👤 Profile: " + username +
                            "\n📦 Items: " + itemUrls.length + " found" +
                            "\n\nStarting download of all items..." +
                            "\n\nThis may take several minutes!";
          
          alert(alertMessage);
          console.log("Profile info extracted:", profileData);
          
          resolve(profileData);
        });
      });
    }
  }, function(results) {
    console.log("Profile extraction callback, results:", results);
    
    if (chrome.runtime.lastError) {
      console.error("Profile script error:", chrome.runtime.lastError);
      scrapingActive = false;
      return;
    }
    
    if (!results || !results[0] || !results[0].result) {
      console.error("No results returned from profile extraction");
      scrapingActive = false;
      return;
    }
    
    var result = results[0].result;
    console.log("Result type:", typeof result, "Result:", result);
    
    // Handle the promise result
    if (result && typeof result.then === 'function') {
      // It's a Promise, wait for it
      result.then(function(profileData) {
        console.log("Got profile data from promise:", profileData);
        
        if (!profileData || !profileData.itemUrls) {
          console.error("Invalid profile data:", profileData);
          scrapingActive = false;
          return;
        }
        
        currentProfileData = profileData;
        console.log("Profile data ready:", currentProfileData.username, "-", currentProfileData.itemUrls.length, "items");
        
        // Initialize progress
        progressInfo = {
          completed: 0,
          failed: 0,
          total: currentProfileData.itemUrls.length,
          current: 0
        };

        // Send initial progress
        sendProgressUpdate();
        
        // Show starting message
        chrome.runtime.sendMessage({
          action: 'scrapingProgress',
          completed: 0,
          failed: 0,
          total: currentProfileData.itemUrls.length,
          current: 1
        });

        // Start scraping each item
        scrapeAllProfileItems(currentProfileData);
        
      }).catch(function(error) {
        console.error("Error in profile promise:", error);
        scrapingActive = false;
        
        // Send error message
        chrome.runtime.sendMessage({
          action: 'scrapingError',
          error: 'Profile extraction failed: ' + error.message
        });
      });
    } else {
      // Direct result (not a promise)
      console.log("Got direct result (not a promise):", result);
      
      if (!result || !result.itemUrls) {
        console.error("Invalid direct profile data:", result);
        scrapingActive = false;
        return;
      }
      
      currentProfileData = result;
      console.log("Profile data ready (direct):", currentProfileData.username, "-", currentProfileData.itemUrls.length, "items");
      
      // Initialize progress
      progressInfo = {
        completed: 0,
        failed: 0,
        total: currentProfileData.itemUrls.length,
        current: 0
      };

      // Send initial progress
      sendProgressUpdate();
      
      // Show starting message
      chrome.runtime.sendMessage({
        action: 'scrapingProgress',
        completed: 0,
        failed: 0,
        total: currentProfileData.itemUrls.length,
        current: 1
      });

      // Start scraping each item
      scrapeAllProfileItems(currentProfileData);
    }
  });
}
  if (message.action === 'stopScraping') {
    console.log("🛑 Stop requested by user");
    scrapingStopped = true;
    
    // Send confirmation back
    chrome.runtime.sendMessage({
      action: 'scrapingStopped',
      completed: progressInfo.completed
    });
    
    sendResponse({stopped: true});
  }
  
  // NEW: Handle status check
  if (message.action === 'getScrapingStatus') {
    sendResponse({
      isScraping: scrapingActive,
      progress: progressInfo
    });
  }
  
  return false;
});

// ===== EXTRACT PROFILE INFO =====
function extractProfileInfo() {
  console.log("==== EXTRACTING PROFILE INFO ====");
  
  // 1. Get username
  var username = '';
  var usernameEl = document.querySelector("[data-testid='profile-username'], h1");
  if (usernameEl) {
    username = usernameEl.innerText.trim();
    console.log("✅ Username found:", username);
  } else {
    // Fallback: extract from URL
    var path = window.location.pathname.split('/');
    username = path[path.length - 1] || 'vinted_user';
    console.log("ℹ️ Username from URL:", username);
  }

  // 2. Get total item count from the closet header
  var totalItems = 0;
  try {
    var closetHeader = document.querySelector("h2.web_ui__Text__text.web_ui__Text__title.web_ui__Text__left");
    if (closetHeader) {
      var closetText = closetHeader.textContent.trim();
      var match = closetText.match(/(\d+)/);
      if (match) {
        totalItems = parseInt(match[1]);
        console.log("📊 Total items in closet:", totalItems);
      }
    }
  } catch (e) {
    console.log("ℹ️ Could not get total item count:", e);
  }

  // 3. Function to scroll and load all items
  function scrollToLoadAllItems() {
    return new Promise((resolve) => {
      console.log("🔄 Starting to scroll to load all items...");
      
      var scrolls = 0;
      var maxScrolls = totalItems > 0 ? Math.ceil(totalItems / 20) * 2 + 5 : 50; // Adjust based on item count
      var lastHeight = 0;
      var currentHeight = 0;
      var sameHeightCount = 0;
      
      function scrollStep() {
        if (scrolls >= maxScrolls || sameHeightCount >= 3) {
          console.log(`✅ Finished scrolling after ${scrolls} attempts`);
          resolve();
          return;
        }
        
        // Scroll to bottom
        window.scrollTo(0, document.body.scrollHeight);
        
        // Wait for content to load
        setTimeout(function() {
          currentHeight = document.body.scrollHeight;
          
          // Check if we're still loading new content
          if (currentHeight === lastHeight) {
            sameHeightCount++;
          } else {
            sameHeightCount = 0;
            lastHeight = currentHeight;
          }
          
          // Also scroll incrementally to trigger lazy loading
          var scrollIncrement = 500;
          for (var i = 0; i < currentHeight; i += scrollIncrement) {
            window.scrollTo(0, i);
          }
          
          scrolls++;
          
          // Show progress
          var loadedItems = document.querySelectorAll('a.new-item-box__overlay[href*="/items/"]').length;
          console.log(`📊 Scroll ${scrolls}/${maxScrolls}: Loaded ${loadedItems} items`);
          
          // Check if we've loaded all expected items
          if (totalItems > 0 && loadedItems >= totalItems) {
            console.log(`✅ Loaded all ${totalItems} items!`);
            resolve();
            return;
          }
          
          // Continue scrolling
          setTimeout(scrollStep, 1500);
        }, 2000);
      }
      
      scrollStep();
    });
  }

  // 4. Scroll to load all items first
  return scrollToLoadAllItems().then(function() {
    // 5. Now get all item URLs
    var itemUrls = [];
    var allItemLinks = [];
    var attempts = 0;
    var maxAttempts = 5;
    
    // Try multiple times to ensure we get all items
    while (attempts < maxAttempts) {
      // Get current links
      var currentLinks = document.querySelectorAll('a.new-item-box__overlay[href*="/items/"]');
      console.log(`Attempt ${attempts + 1}: Found ${currentLinks.length} item links`);
      
      // Add new links
      for (var i = 0; i < currentLinks.length; i++) {
        var href = currentLinks[i].getAttribute('href');
        if (href && href.includes('/items/')) {
          var urlPath = href.split('?')[0];
          if (urlPath.match(/\/items\/\d+/)) {
            var fullUrl = href.startsWith('http') ? href : 'https://www.vinted.it' + href;
            fullUrl = fullUrl.split('?')[0];
            
            if (!itemUrls.includes(fullUrl)) {
              itemUrls.push(fullUrl);
              allItemLinks.push(currentLinks[i]);
            }
          }
        }
      }
      
      // Scroll a bit more and wait for potential new loads
      if (attempts < maxAttempts - 1) {
        window.scrollBy(0, 1000);
        // Small delay to allow any new items to load
        return new Promise(resolve => setTimeout(resolve, 1000)).then(function() {
          attempts++;
          // Continue loop
        });
      } else {
        attempts++;
      }
    }
    
    console.log("✅ Final count:", itemUrls.length, "unique items found");
    
    // If we have a totalItems count, compare
    if (totalItems > 0 && itemUrls.length < totalItems) {
      console.warn(`⚠️ Warning: Found only ${itemUrls.length} items, expected ${totalItems}`);
    }
    
    // 6. Return profile data
    var profileData = {
      username: username,
      itemUrls: itemUrls,
      profileUrl: window.location.href,
      scrapedAt: new Date().toISOString(),
      totalItems: totalItems
    };
    
    // Show confirmation
    var message = "👤 Profile: " + username +
                  "\n📦 Items: " + itemUrls.length + " found" +
                  (totalItems > 0 ? " (expected: " + totalItems + ")" : "") +
                  "\n\nStarting download of all items..." +
                  "\n\nThis may take several minutes!";
    
    alert(message);
    console.log("Profile info extracted:", profileData);
    
    return profileData;
  });
}

function sendProgressUpdate() {
  chrome.runtime.sendMessage({
    action: 'scrapingProgress',
    completed: progressInfo.completed,
    failed: progressInfo.failed,
    total: progressInfo.total,
    current: progressInfo.current
  });
}

// ===== SCRAPE ALL PROFILE ITEMS =====
// Update scrapeAllProfileItems function
function scrapeAllProfileItems(profileData) {
  console.log("🚀 Starting to scrape", profileData.itemUrls.length, "items from profile:", profileData.username);
  
  var currentItem = 0;
  var completedItems = 0;
  var failedItems = 0;
  
  // Function to scrape next item
  function scrapeNextItem() {
    // CHECK FOR STOP REQUEST
    if (scrapingStopped) {
      console.log("🛑 Stopping as requested by user");
      scrapingActive = false;
      return;
    }
    
    if (currentItem >= profileData.itemUrls.length) {
      console.log("✅ ALL ITEMS COMPLETED!");
      console.log("Success:", completedItems, "Failed:", failedItems);
      
      scrapingActive = false;
      
      // Send completion message
      chrome.runtime.sendMessage({
        action: 'scrapingComplete',
        completed: completedItems,
        failed: failedItems,
        total: profileData.itemUrls.length
      });
      
      return;
    }
    
    var itemUrl = profileData.itemUrls[currentItem];
    var itemNumber = currentItem + 1;
    var totalItems = profileData.itemUrls.length;
    
    // Update progress
    progressInfo.current = itemNumber;
    sendProgressUpdate();
    
    console.log(`📦 [${itemNumber}/${totalItems}] Opening: ${itemUrl}`);
    
    // Create a new tab for this item
    chrome.tabs.create({
      url: itemUrl,
      active: false
    }, function(newTab) {
      console.log("Opened tab", newTab.id, "for item", itemNumber);
      
      // Wait for page to load, then scrape
      setTimeout(function() {
        chrome.scripting.executeScript({
          target: {tabId: newTab.id},
          func: scrapeVintedItem
        }, function(results) {
          // Close the item tab
          chrome.tabs.remove(newTab.id);
          
          if (results && results[0] && results[0].result) {
            var itemData = results[0].result;
            
            console.log(`✅ [${itemNumber}/${totalItems}] Scraped: ${itemData.title || 'Unknown item'}`);
            
            // Modify the item data for profile structure
            itemData.folderName = sanitizeFilename(profileData.username) + '/' + itemData.folderName;
            
            // Add profile info
            itemData.infoContent = `FROM PROFILE: ${profileData.username}\n` +
                                  `PROFILE URL: ${profileData.profileUrl}\n` +
                                  `ITEM ${itemNumber} of ${totalItems}\n` +
                                  `=======================\n\n` +
                                  itemData.infoContent;
            
            // Download the item files
            downloadAllFiles(itemData);
            completedItems++;
            progressInfo.completed = completedItems;
            
          } else {
            console.error(`❌ [${itemNumber}/${totalItems}] Failed to scrape`);
            failedItems++;
            progressInfo.failed = failedItems;
          }
          
          // Send progress update
          sendProgressUpdate();
          
          // Move to next item with delay (check for stop first)
          currentItem++;
          if (!scrapingStopped) {
            setTimeout(scrapeNextItem, 3000);
          } else {
            console.log("🛑 Stopping after current item");
            scrapingActive = false;
          }
        });
      }, 3000);
    });
  }
  
  // Start scraping first item
  scrapeNextItem();
}

// ===== YOUR EXISTING FUNCTIONS (KEEP AS-IS) =====
function scrapeVintedItem() {
  console.log("==== [1] scrapeVintedItem STARTED ====");

  // Helper function for profile sanitization
  function sanitizeFilename(name) {
    if (!name) return 'vinted_item';
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .trim()
      .substring(0, 40);
  }
  
  try {
    // Helper: pulisci prezzo
    function parsePrice(priceStr) {
      console.log("[parsePrice] Input:", priceStr);
      if (!priceStr) return 0;
      var match = priceStr.match(/(\d+)[,.]?(\d+)?/);
      if (match) return parseInt(match[1]);
      return 0;
    }
    
    // Helper: estrai ID da URL
    function extractIdFromUrl(url, pattern) {
      var match = url.match(pattern);
      return match ? match[1] : null;
    }
    
    console.log("[2] Getting basic data...");
    
    // ===== 1. DATI BASE =====
    var url = window.location.href;
    console.log("[3] URL:", url);
    
    var itemId = extractIdFromUrl(url, /\/items\/(\d+)/);
    console.log("[4] Item ID:", itemId);
    
    // Titolo
    var title = '';
    var titleEl = document.querySelector("h1[data-testid*='item-title'], h1");
    if (titleEl) title = titleEl.innerText.trim();
    console.log("[5] Title:", title);
    
    // Prezzo
    var price = 0;
    var priceEl = document.querySelector("[data-testid*='item-price']");
    if (priceEl) price = parsePrice(priceEl.innerText.trim());
    console.log("[6] Price:", price);
    
    // Descrizione
    var description = '';
    var descEl = document.querySelector("[itemprop='description'], .description, [data-testid*='description']");
    if (descEl) description = descEl.innerText.trim();
    console.log("[7] Description length:", description.length);
    
    console.log("[8] Getting brand...");
    
    // ===== 2. BRAND =====
    var brandId = null;
    var brandName = '';
    
    var brandLink = document.querySelector("a[href*='/brands/']");
    if (brandLink) {
      brandName = brandLink.innerText.trim();
      var brandMatch = brandLink.href.match(/\/brands\/(\d+)/);
      if (brandMatch) brandId = parseInt(brandMatch[1]);
    }
    
    if (!brandName) {
      var brandSpan = document.querySelector("[data-testid*='brand'], .brand-name");
      if (brandSpan) brandName = brandSpan.innerText.trim();
    }
    console.log("[9] Brand:", brandName, "ID:", brandId);
    
    console.log("[10] Getting size...");
    
    // ===== 3. SIZE =====
    var sizeId = null;
    var sizeName = '';
    
    var sizeEl = document.querySelector("[data-testid*='size'], .size-selector__selected");
    if (sizeEl) {
      sizeName = sizeEl.innerText.trim();
    }
    
    if (!sizeId) {
      var sizeOption = document.querySelector('select[name="size_id"] option:checked');
      if (sizeOption) {
        sizeId = parseInt(sizeOption.value);
        sizeName = sizeOption.innerText.trim();
      }
    }
    console.log("[11] Size:", sizeName, "ID:", sizeId);
    
    console.log("[12] Getting condition...");
    
    // ===== 4. CONDITION =====
    var conditionId = null;
    var conditionName = '';
    
    var conditionMap = {
      'Nuovo con tag': 1, 'Nuovo senza tag': 1, 'Nuovo': 1,
      'Ottime': 2, 'Ottimo': 2,
      'Buone': 3, 'Buono': 3,
      'Discrete': 4, 'Discreto': 4,
      'Mediocre': 5
    };
    
    var conditionEl = document.querySelector("[data-testid*='condition'], .condition");
    if (conditionEl) {
      conditionName = conditionEl.innerText.trim();
      conditionId = conditionMap[conditionName] || 3;
    }
    console.log("[13] Condition:", conditionName, "ID:", conditionId);
    
    console.log("[14] Getting color...");
    
    // ===== 5. COLOR =====
    var colorIds = [];
    var colorNames = [];
    
    var colorMap = {
      'Nero': 1, 'Black': 1,
      'Bianco': 2, 'White': 2,
      'Grigio': 3, 'Gray': 3,
      'Blu': 4, 'Blue': 4,
      'Rosso': 5, 'Red': 5,
      'Verde': 6, 'Green': 6,
      'Giallo': 7, 'Yellow': 7,
      'Marrone': 8, 'Brown': 8,
      'Rosa': 9, 'Pink': 9,
      'Viola': 10, 'Purple': 10,
      'Arancione': 11, 'Orange': 11,
      'Beige': 12,
      'Oro': 13, 'Gold': 13,
      'Argento': 14, 'Silver': 14,
      'Multicolore': 15, 'Multicolor': 15
    };
    
    var colorEl = document.querySelector("[data-testid*='color'], .color");
    if (colorEl) {
      var colorText = colorEl.innerText.trim();
      var colorParts = colorText.split(/[,&]/);
      for (var i = 0; i < colorParts.length; i++) {
        var part = colorParts[i].trim();
        if (colorMap[part]) {
          colorIds.push(colorMap[part]);
          colorNames.push(part);
        }
      }
    }
    
    if (colorIds.length === 0 && colorEl) {
      colorIds = [1];
      colorNames = [colorEl.innerText.trim()];
    }
    console.log("[15] Colors:", colorNames, "IDs:", colorIds);
    
    console.log("[16] Getting catalog ID...");
    
    // ===== 6. CATALOG ID (categoria) =====
    var catalogId = null;
    
    var catalogElement = document.querySelector('[data-catalog-id]');
    if (catalogElement) {
      catalogId = parseInt(catalogElement.getAttribute('data-catalog-id'));
    }
    
    if (!catalogId) {
      var breadcrumbLinks = document.querySelectorAll('.breadcrumb a, [data-testid*="breadcrumb"] a');
      console.log("[17] Breadcrumb links found:", breadcrumbLinks.length);
      for (var i = 0; i < breadcrumbLinks.length; i++) {
        var link = breadcrumbLinks[i];
        var catMatch = link.href.match(/\/catalog\/(\d+)/);
        if (catMatch) {
          catalogId = parseInt(catMatch[1]);
          break;
        }
      }
    }
    console.log("[18] Catalog ID:", catalogId);
    
    console.log("[19] Getting package size...");
    
    // ===== 7. PACKAGE SIZE =====
    var packageSizeId = 2;
    if (catalogId && (catalogId === 100 || catalogId === 101 || catalogId === 120 || catalogId === 130)) {
      packageSizeId = 1;
    }
    if (title && (title.toLowerCase().indexOf('scarpe') !== -1 || title.toLowerCase().indexOf('stivali') !== -1)) {
      packageSizeId = 2;
    }
    if (title && (title.toLowerCase().indexOf('piumino') !== -1 || title.toLowerCase().indexOf('cappotto') !== -1)) {
      packageSizeId = 3;
    }
    console.log("[20] Package size ID:", packageSizeId);
    
    console.log("[21] Getting images...");
    
    // ===== 8. IMMAGINI =====
    var imageUrls = [];
    var imgElements = document.querySelectorAll('[data-testid^="item-photo-"] img, .item-photo img, .carousel img');
    console.log("[22] Image elements found:", imgElements.length);
    
    for (var i = 0; i < imgElements.length; i++) {
      var src = imgElements[i].src;
      if (src && src.indexOf('vinted.net') !== -1) {
        src = src.replace('/320/', '/0/').replace('/426/', '/0/');
        if (imageUrls.indexOf(src) === -1) {
          imageUrls.push(src);
        }
      }
    }
    
    console.log("[23] Unique image URLs found:", imageUrls.length);
    
    console.log("[24] Preparing metadata...");
    
    // ===== 9. PREPARA METADATA =====
    var folderName = sanitizeFilename(title || 'vinted_item');
    console.log("[25] Folder name:", folderName);
    
    var metadata = {
      original_item_id: itemId,
      original_url: url,
      scraped_at: new Date().toISOString(),
      title: title,
      price: price,
      description: description,
      brand_id: brandId,
      brand_name: brandName,
      catalog_id: catalogId,
      size_id: sizeId,
      size_name: sizeName,
      condition_id: conditionId,
      condition_name: conditionName,
      color_ids: colorIds,
      color_names: colorNames,
      package_size_id: packageSizeId,
      image_count: imageUrls.length,
      image_filenames: [],
      image_urls: imageUrls
    };
    console.log("[26] Metadata created successfully");
    
    // ===== 10. DESCRIPTION.TXT =====
    var infoContent = "VINTED ITEM INFORMATION\n" +
      "=======================\n\n" +
      "Title: " + (title || 'N/A') + "\n" +
      "Price: " + price + " €\n" +
      "Size: " + (sizeName || 'N/A') + "\n" +
      "Condition: " + (conditionName || 'N/A') + "\n" +
      "Color: " + (colorNames.join(', ') || 'N/A') + "\n" +
      "Brand: " + (brandName || 'N/A') + "\n\n" +
      "DESCRIPTION:\n" + (description || 'No description available') + "\n\n" +
      "--- METADATA FOR REPOST ---\n" +
      "brand_id: " + (brandId || 'unknown') + "\n" +
      "catalog_id: " + (catalogId || 'unknown') + "\n" +
      "size_id: " + (sizeId || 'unknown') + "\n" +
      "condition_id: " + (conditionId || '3') + "\n" +
      "color_ids: " + (colorIds.join(',') || '1') + "\n" +
      "package_size_id: " + packageSizeId;
    
    console.log("[27] Info content created, length:", infoContent.length);
    
    var messageText = "📦 " + (title || 'Item') + "\n💰 " + price + " €\n📸 " + imageUrls.length + " images\n\n✅ Metadata saved for repost!";
    alert(messageText);
    
    console.log("[28] Returning data to service worker...");
    
    return {
      title: title,
      price: price,
      description: description,
      size: sizeName,
      condition: conditionName,
      color: colorNames.join(', '),
      brand: brandName,
      images: imageUrls,
      folderName: folderName,
      infoContent: infoContent,
      metadata: metadata,
      url: url
    };
    
  } catch (error) {
    console.error("[ERROR] scrapeVintedItem crashed:", error);
    console.error("[ERROR] Stack trace:", error.stack);
    alert("Error scraping item: " + error.message);
    return null;
  }
}
// Download files using Chrome API (runs in service worker)
function downloadAllFiles(itemData) {
  console.log("Starting downloads for folder:", itemData.folderName);
  
  // 1. Download Description.txt
  chrome.downloads.download({
    url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(itemData.infoContent),
    filename: itemData.folderName + '/Description.txt',
    saveAs: false,
    conflictAction: 'uniquify'
  });
  
  // 2. Download metadata.json (NUOVO!)
  if (itemData.metadata) {
    const metadataJson = JSON.stringify(itemData.metadata, null, 2);
    chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(metadataJson),
      filename: itemData.folderName + '/metadata.json',
      saveAs: false,
      conflictAction: 'uniquify'
    });
    console.log("✅ metadata.json queued");
  }
  
  // 3. Download images with delays
  if (itemData.images && itemData.images.length > 0) {
    console.log("Queuing", itemData.images.length, "images for download...");
    
    itemData.images.forEach(function(imageUrl, index) {
      setTimeout(function() {
        const extension = getFileExtension(imageUrl);
        const filename = itemData.folderName + '/' + 
                        sanitizeFilename(itemData.title || 'item') + 
                        '_' + (index + 1) + extension;
        
        // Aggiorna metadata con il nome del file (opzionale)
        if (itemData.metadata && itemData.metadata.image_filenames) {
          // Questo verrà fatto in un secondo momento
        }
        
        chrome.downloads.download({
          url: imageUrl,
          filename: filename,
          saveAs: false,
          conflictAction: 'uniquify'
        }, function(downloadId) {
          if (chrome.runtime.lastError) {
            console.error("Error downloading image", index + 1, ":", chrome.runtime.lastError);
          } else {
            console.log("✅ Image", index + 1, "downloading (ID:", downloadId + ")");
          }
        });
      }, index * 2000);
    });
  }
  
  console.log("✅ All downloads queued!");
}

function getFileExtension(url) {
  if (url.includes('.jpg') || url.includes('.jpeg')) return '.jpg';
  if (url.includes('.png')) return '.png';
  if (url.includes('.gif')) return '.gif';
  return '.webp';
}

// Helper function for profile sanitization
function sanitizeFilename(name) {
  if (!name) return 'vinted_item';
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim()
    .substring(0, 40);
}