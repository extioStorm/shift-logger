const STORAGE_KEY = "shift_profiles";
const LAST_PROFILE_KEY = "last_active_profile";

const $ = (id) => document.getElementById(id);

let shiftDateWasManuallyChanged = false;

// ─── Small helpers ────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, "0");

// "HH:MM" -> minutes since midnight
function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function toHHMM(hour, minute) {
    return pad2(hour) + ":" + pad2(minute);
}

// Date -> "YYYY-MM-DD" in local time (for <input type="date">)
function toISODate(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

// A time <select> holds "--" until a real time is chosen
function isRealTime(value) {
    return !!value && value !== "--";
}

function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}

function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
}

let toastTimer = null;

function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}

// ─── PWA Install Prompt ───────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("installButton").style.display = "block";
});

window.addEventListener("appinstalled", () => {
    $("installButton").style.display = "none";
    deferredPrompt = null;
});

function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
        deferredPrompt = null;
        $("installButton").style.display = "none";
    });
}

// Register the service worker
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
            .catch(err => console.log("SW registration failed:", err));
    });
}

// ─── Contact Picker & SMS Handling ────────────────────────────────────
async function pickBossContact() {
    // Check if Contact Picker API is supported in this browser
    if (!("contacts" in navigator && navigator.contacts && "select" in navigator.contacts)) {
        alert("The Contact Picker feature is only supported on mobile devices running Chrome/Edge on Android over HTTPS.\n\nPlease type or paste the phone number manually.");
        $("bossPhone").focus();
        return;
    }

    try {
        if ("getProperties" in navigator.contacts) {
            const supportedProps = await navigator.contacts.getProperties();
            if (!supportedProps.includes("tel")) {
                alert("Your device does not support selecting phone numbers via the Contact Picker.");
                return;
            }
        }

        const contacts = await navigator.contacts.select(["tel"], { multiple: false });
        if (contacts && contacts.length > 0 && contacts[0].tel && contacts[0].tel.length > 0) {
            $("bossPhone").value = contacts[0].tel[0];
            autoSaveBossPhoneToProfile();
        }
    } catch (err) {
        if (err.name !== "AbortError") {
            alert("Could not load contact: " + err.message);
        }
    }
}

function autoSaveBossPhoneToProfile() {
    const profile = profiles[selectedProfileIndex()];
    if (!profile) return;

    profile.bossPhone = $("bossPhone").value.trim();
    saveProfiles();
}

function sendToBoss() {
    let output = $("output").value;

    if (!output) {
        generateLog();
        output = $("output").value;
        if (!output) return;
    }

    const phone = $("bossPhone").value.trim();
    if (!phone) {
        alert("Please enter or pick a phone number for your boss in Job & Project Details.");
        $("jobDetailsPanel").open = true;
        $("bossPhone").focus();
        return;
    }

    const cleanNumber = phone.replace(/[^\d+]/g, "");
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const delimiter = isIOS ? "&" : "?";

    window.location.href = `sms:${cleanNumber}${delimiter}body=${encodeURIComponent(output)}`;
}

// ─── Profiles ─────────────────────────────────────────────────────────
// Every saved profile has exactly these fields. Text inputs and checkboxes
// share their element id with the profile key, so they load/save in a loop.
const TEXT_FIELDS = [
    "jobNum", "fedProject", "location", "payItem",
    "truck", "bossPhone", "previousOdometer"
];

const CHECK_FIELDS = [
    "showPreviousOdometer", "includeMilesDriven",
    "useQuarterHour", "showUnpaidBreak"
];

const BLANK_PROFILE = {
    name: "",
    jobNum: "",
    fedProject: "",
    location: "",
    payItem: "",
    truck: "",
    bossPhone: "",
    previousOdometer: "",
    startTime: "--",
    endTime: "--",
    showPreviousOdometer: false,
    includeMilesDriven: false,
    useQuarterHour: false,
    showUnpaidBreak: false
};

const DEFAULT_PROFILE = {
    ...BLANK_PROFILE,
    name: "Default",
    jobNum: "000000",
    payItem: "420***"
};

// Keep only known fields, filling in anything missing
function normalizeProfile(profile) {
    const clean = {};
    for (const key of Object.keys(BLANK_PROFILE)) {
        clean[key] = profile[key] ?? BLANK_PROFILE[key];
    }
    return clean;
}

function loadProfilesFromStorage() {
    const stored = storageGet(STORAGE_KEY);

    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                const valid = parsed.filter(p => p && typeof p === "object");
                if (valid.length > 0) return valid.map(normalizeProfile);
            }
        } catch (error) {
            // fall through to the default profile
        }
    }

    return [{ ...DEFAULT_PROFILE }];
}

// Loaded once at startup; every change goes through saveProfiles()
let profiles = [];

function saveProfiles() {
    storageSet(STORAGE_KEY, JSON.stringify(profiles));
}

// Index of the selected profile, or -1 for the "unsaved new profile" entry
function selectedProfileIndex() {
    const value = $("profileSelect").value;
    return value === "new" ? -1 : Number(value);
}

function renderProfiles() {
    $("profileSelect").replaceChildren(
        ...profiles.map((profile, index) => new Option(profile.name, index))
    );
}

// Put a profile's values into the form
function applyProfileToForm(profile) {
    for (const id of TEXT_FIELDS) {
        $(id).value = profile[id] || "";
    }

    for (const id of CHECK_FIELDS) {
        $(id).checked = profile[id] === true;
    }

    togglePreviousOdometer();
    toggleUnpaidBreak();

    populateTimes(profile.useQuarterHour === true);

    $("startTime").value = profile.startTime || "--";
    $("endTime").value = profile.endTime || "--";

    updateNowButtonText();
}

// Read the form into a profile object
function readProfileFromForm(name) {
    const profile = { name };

    for (const id of TEXT_FIELDS) {
        profile[id] = $(id).value.trim();
    }

    for (const id of CHECK_FIELDS) {
        profile[id] = $(id).checked;
    }

    profile.startTime = $("startTime").value;
    profile.endTime = $("endTime").value;

    return profile;
}

function loadSelectedProfile() {
    const index = selectedProfileIndex();
    const profile = profiles[index];

    if (!profile) return;

    applyProfileToForm(profile);
    storageSet(LAST_PROFILE_KEY, String(index));
}

function createNewBlankProfile() {
    const select = $("profileSelect");

    let newOption = select.querySelector('option[value="new"]');

    if (!newOption) {
        newOption = new Option("-- Unsaved New Profile --", "new");
        select.appendChild(newOption);
    }

    select.value = "new";

    applyProfileToForm(BLANK_PROFILE);
    $("breakMins").value = "0";

    shiftDateWasManuallyChanged = false;
    updateAutomaticShiftDate();

    $("jobDetailsPanel").open = true;
    $("jobNum").focus();
}

function saveProfile() {
    const selectedIndex = selectedProfileIndex();
    const existingProfile = profiles[selectedIndex];
    let profileName;

    if (existingProfile) {
        if (!confirm("Overwrite the current profile?")) return;
        profileName = existingProfile.name;
    } else {
        const locVal = $("location").value.trim();
        const jobVal = $("jobNum").value.trim();
        const payVal = $("payItem").value.trim();
        const truckVal = $("truck").value.trim();

        let defaultName = "";

        if (locVal && jobVal) defaultName = `${locVal} (${jobVal})`;
        else if (locVal) defaultName = locVal;
        else if (jobVal) defaultName = `Job ${jobVal}`;
        else if (payVal) defaultName = `Pay Item ${payVal}`;
        else if (truckVal) defaultName = truckVal;
        else defaultName = "Default";

        profileName = prompt("Enter a name for this profile:", defaultName);

        if (!profileName) return;
    }

    const profile = readProfileFromForm(profileName);

    if (existingProfile) {
        profiles[selectedIndex] = profile;
    } else {
        profiles.push(profile);
    }

    saveProfiles();
    renderProfiles();

    const newIndex = existingProfile ? selectedIndex : profiles.length - 1;

    $("profileSelect").value = String(newIndex);
    storageSet(LAST_PROFILE_KEY, String(newIndex));

    showToast("Profile saved.");
}

function deleteProfile() {
    const index = selectedProfileIndex();

    if (index === -1) {
        renderProfiles();
        loadSelectedProfile();
        return;
    }

    if (!profiles[index]) return;
    if (!confirm("Delete the current profile?")) return;

    profiles.splice(index, 1);

    if (profiles.length === 0) {
        profiles.push({ ...DEFAULT_PROFILE });
    }

    saveProfiles();
    storageRemove(LAST_PROFILE_KEY);

    renderProfiles();
    createNewBlankProfile();
}

function updateProfilePreviousOdometer(odometer) {
    const profile = profiles[selectedProfileIndex()];

    if (profile) {
        profile.previousOdometer = String(odometer);
        saveProfiles();
    }

    $("previousOdometer").value = String(odometer);
}

// ─── Option toggles ───────────────────────────────────────────────────
function togglePreviousOdometer() {
    const showPrevious = $("showPreviousOdometer").checked;
    const includeMiles = $("includeMilesDriven");

    $("previousOdometerGroup").style.display = showPrevious ? "block" : "none";
    includeMiles.disabled = !showPrevious;

    if (!showPrevious) {
        includeMiles.checked = false;
    }
}

function toggleIncludeMilesDriven() {
    const includeMiles = $("includeMilesDriven");

    if (!$("showPreviousOdometer").checked) {
        includeMiles.checked = false;
        includeMiles.disabled = true;
    }
}

function toggleUnpaidBreak() {
    const showBreak = $("showUnpaidBreak").checked;

    $("unpaidBreakGroup").style.display = showBreak ? "block" : "none";

    if (!showBreak) {
        $("breakMins").value = "0";
    }
}

// ─── Times & dates ────────────────────────────────────────────────────
function populateTimes(useQuarterHour) {
    const start = $("startTime");
    const end = $("endTime");

    const oldStart = start.value;
    const oldEnd = end.value;

    const increment = useQuarterHour ? 15 : 30;
    const values = ["--"];

    for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += increment) {
            values.push(toHHMM(hour, minute));
        }
    }

    for (const select of [start, end]) {
        select.replaceChildren(
            ...values.map(v => new Option(v === "--" ? "--" : formatTime(v), v))
        );
    }

    start.value = values.includes(oldStart) ? oldStart : "--";
    end.value = values.includes(oldEnd) ? oldEnd : "--";
}

function timeRoundingChanged() {
    populateTimes($("useQuarterHour").checked);
    updateNowButtonText();
    updateAutomaticShiftDate();
}

function updateNowButtonText() {
    $("nowButton").textContent =
        $("useQuarterHour").checked
            ? "Set End Time to NOW (Rounded 15m)"
            : "Set End Time to NOW (Rounded 30m)";
}

function formatTime(timeValue) {
    const [hourText, minute] = timeValue.split(":");
    const hour = Number(hourText);
    const suffix = hour >= 12 ? "PM" : "AM";

    return (hour % 12 || 12) + ":" + minute + " " + suffix;
}

function shiftDateManuallyChanged() {
    shiftDateWasManuallyChanged = !!$("shiftDate").value;
}

function updateAutomaticShiftDate() {
    if (shiftDateWasManuallyChanged) return;

    const startVal = $("startTime").value;
    const endVal = $("endTime").value;

    if (!isRealTime(startVal) || !isRealTime(endVal)) return;

    const date = new Date();

    // End at or before start means the shift ran past midnight
    // (equal times count as a full 24-hour shift)
    if (toMinutes(endVal) <= toMinutes(startVal)) {
        date.setDate(date.getDate() - 1);
    }

    $("shiftDate").value = toISODate(date);
}

function setEndToNow() {
    const now = new Date();

    const step = $("useQuarterHour").checked ? 15 : 30;

    // Round to the nearest step. setMinutes() rolls over into the next
    // hour (and past midnight into the next day) when it rounds up to 60.
    const rounded = new Date(now);
    rounded.setMinutes(Math.round(now.getMinutes() / step) * step, 0, 0);

    const hour = rounded.getHours();
    const minute = rounded.getMinutes();

    $("endTime").value = toHHMM(hour, minute);

    if (!shiftDateWasManuallyChanged) {
        const startVal = $("startTime").value;

        // Count back from the rounded end time (not "now"), so rounding
        // up past midnight (e.g. 11:55 PM -> 12:00 AM) lands on the
        // correct start date.
        const targetDate = new Date(rounded);

        if (isRealTime(startVal) && hour * 60 + minute <= toMinutes(startVal)) {
            targetDate.setDate(targetDate.getDate() - 1);
        }

        $("shiftDate").value = toISODate(targetDate);
    }
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatDate(date) {
    return days[date.getDay()] + " " + months[date.getMonth()] + " " + date.getDate();
}

function formatShiftDates(startDate, endDate) {
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    if (startYear !== endYear) {
        return (
            formatDate(startDate) + ", " + startYear +
            " - " +
            formatDate(endDate) + ", " + endYear
        );
    }

    if (startDate.getMonth() !== endDate.getMonth()) {
        return formatDate(startDate) + "-" + formatDate(endDate);
    }

    if (startDate.getDate() !== endDate.getDate()) {
        return (
            days[startDate.getDay()] + "-" + days[endDate.getDay()] + " " +
            months[startDate.getMonth()] + " " +
            startDate.getDate() + "-" + endDate.getDate()
        );
    }

    return formatDate(startDate);
}

// ─── Log generation ───────────────────────────────────────────────────
function generateLog() {
    if (!shiftDateWasManuallyChanged) {
        updateAutomaticShiftDate();
    }

    const jobNum = $("jobNum").value.trim();
    const fedProject = $("fedProject").value.trim();
    const locationVal = $("location").value.trim();
    const payItem = $("payItem").value.trim();
    const truck = $("truck").value.trim();

    const startTime = $("startTime").value;
    const endTime = $("endTime").value;

    const showUnpaidBreak = $("showUnpaidBreak").checked;
    const breakMins = showUnpaidBreak ? Number($("breakMins").value) : 0;

    const shiftDateValue = $("shiftDate").value;

    const previousOdometer = $("previousOdometer").value.trim();
    const includeMilesDriven = $("includeMilesDriven").checked;
    const odometer = $("odometer").value.trim();

    if (!isRealTime(startTime)) {
        alert("Please select a Start Time.");
        $("startTime").focus();
        return;
    }

    if (!isRealTime(endTime)) {
        alert("Please select an End Time.");
        $("endTime").focus();
        return;
    }

    if (odometer === "") {
        alert(
            "Please enter the Ending Odometer " +
            "(or enter 0 for personal vehicle)."
        );
        $("odometer").focus();
        return;
    }

    if (!shiftDateValue) {
        alert("Please select a Start Date of Shift.");
        $("shiftDate").focus();
        return;
    }

    let milesDriven = null;

    if (includeMilesDriven && odometer !== "0") {
        if (!previousOdometer) {
            alert(
                "Include Driven Miles is checked, " +
                "but Previous Odometer is blank."
            );
            $("previousOdometer").focus();
            return;
        }

        const previous = Number(previousOdometer);
        const ending = Number(odometer);

        if (ending < previous) {
            alert("Ending odometer cannot be less than Previous Odometer.");
            $("odometer").focus();
            return;
        }

        milesDriven = ending - previous;
    }

    const [year, month, day] = shiftDateValue.split("-").map(Number);
    const startDate = new Date(year, month - 1, day);

    const startTotalMins = toMinutes(startTime);
    let endTotalMins = toMinutes(endTime);

    const start = new Date(startDate);
    start.setHours(Math.floor(startTotalMins / 60), startTotalMins % 60, 0, 0);

    const end = new Date(startDate);
    end.setHours(Math.floor(endTotalMins / 60), endTotalMins % 60, 0, 0);

    // End at or before start: the shift ends the next day
    if (endTotalMins <= startTotalMins) {
        end.setDate(end.getDate() + 1);
        endTotalMins += 24 * 60;
    }

    const rawWorkedMins = endTotalMins - startTotalMins;

    let totalHours = (rawWorkedMins / 60) - (breakMins / 60);

    if (totalHours < 0) {
        totalHours = 0;
    }

    let dstNote = "";

    if (start.getTimezoneOffset() !== end.getTimezoneOffset()) {
        const isSpringForward =
            start.getTimezoneOffset() > end.getTimezoneOffset();

        const adjustmentAmount = isSpringForward ? -1 : 1;

        const adjustmentLabel =
            isSpringForward
                ? "-1 hour (Spring Forward)"
                : "+1 hour (Fall Back)";

        const applyAdjustment = confirm(
            "Daylight Saving Time change detected.\n\n" +
            "Calculated Hours (Raw): " + totalHours +
            "\n\n" +
            "Did your clock automatically update for DST?\n" +
            "Click OK to apply adjustment [" + adjustmentLabel + "]\n" +
            "Click Cancel to keep raw wall-clock hours."
        );

        if (applyAdjustment) {
            totalHours = Math.max(0, totalHours + adjustmentAmount);
            dstNote = " (DST adjusted: " + (isSpringForward ? "-1 hr" : "+1 hr") + ")";
        } else {
            dstNote = " (DST reviewed: no adjustment)";
        }
    }

    if (totalHours < 4 || totalHours > 16) {
        if (
            !confirm(
                "This shift calculates to " + totalHours + " hours.\n\n" +
                "Are you sure the start and end times are correct?"
            )
        ) return;
    }

    const lines = [];

    if (jobNum) lines.push("Job#: " + jobNum);
    if (fedProject) lines.push(fedProject);
    if (locationVal) lines.push(locationVal);
    if (payItem) lines.push(payItem);

    lines.push("Date: " + formatShiftDates(start, end));

    lines.push(
        "Hours: " + formatTime(startTime) + " - " + formatTime(endTime) +
        " (" + totalHours + " hours)" + dstNote
    );

    if (breakMins > 0) lines.push("Break: " + breakMins + "m unpaid");

    if (odometer !== "0") lines.push("Odometer: " + odometer);

    if (includeMilesDriven && milesDriven !== null) {
        lines.push("Miles: " + milesDriven);
    }

    if (truck) lines.push(truck);

    const output = lines.join("\n");

    $("output").value = output;

    copyText(output);

    if (odometer !== "0") {
        updateProfilePreviousOdometer(odometer);
    }
}

// ─── Clipboard ────────────────────────────────────────────────────────
function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast("Log copied to clipboard."))
            .catch(() => fallbackCopy());
    } else {
        fallbackCopy();
    }
}

function fallbackCopy() {
    const textarea = $("output");

    textarea.focus();
    textarea.select();

    try {
        document.execCommand("copy");
        showToast("Log copied to clipboard.");
    } catch (error) {
        alert(
            "Log generated, but automatic copying failed. " +
            "Please copy manually."
        );
    }
}

// ─── Startup ──────────────────────────────────────────────────────────
function bindEvents() {
    const on = (id, eventName, handler) => $(id).addEventListener(eventName, handler);

    on("profileSelect", "change", loadSelectedProfile);
    on("newProfileBtn", "click", createNewBlankProfile);
    on("bossPhone", "input", autoSaveBossPhoneToProfile);
    on("pickContactBtn", "click", pickBossContact);
    on("saveProfileBtn", "click", saveProfile);
    on("deleteProfileBtn", "click", deleteProfile);

    on("shiftDate", "change", shiftDateManuallyChanged);
    on("startTime", "change", updateAutomaticShiftDate);
    on("endTime", "change", updateAutomaticShiftDate);
    on("nowButton", "click", setEndToNow);

    on("showPreviousOdometer", "change", togglePreviousOdometer);
    on("includeMilesDriven", "change", toggleIncludeMilesDriven);
    on("useQuarterHour", "change", timeRoundingChanged);
    on("showUnpaidBreak", "change", toggleUnpaidBreak);
    on("saveSettingsBtn", "click", saveProfile);

    on("generateBtn", "click", generateLog);
    on("sendBtn", "click", sendToBoss);
    on("installButton", "click", installApp);

    // Select the whole number on tap so it can be overtyped
    for (const id of ["odometer", "previousOdometer"]) {
        on(id, "click", (e) => e.target.select());
    }
}

function init() {
    bindEvents();

    profiles = loadProfilesFromStorage();

    populateTimes(false);
    renderProfiles();

    $("shiftDate").value = toISODate(new Date());
    shiftDateWasManuallyChanged = false;

    const lastProfile = storageGet(LAST_PROFILE_KEY);

    $("profileSelect").value =
        lastProfile !== null && profiles[Number(lastProfile)]
            ? lastProfile
            : "0";

    loadSelectedProfile();

    $("odometer").value = "";
}

window.addEventListener("load", init);
