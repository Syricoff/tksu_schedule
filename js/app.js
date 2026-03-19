import { $, $$ } from './utils.js';
import { storageGet, storageSet, storageInit } from './storage.js';
import { platformName, platformReady, platformShowBack, platformHideBack } from './platform.js';
import * as stu from './students.js';
import * as tch from './teachers.js';

// ── State ──
var activeTab = 'students';

// ── Tab switching ──
function switchTab(tabName) {
    activeTab = tabName;
    $$('.tab-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    $$('.tab-content').forEach(function (el) { el.classList.add('d-none'); });
    var target = $('#tab-' + tabName);
    if (target) target.classList.remove('d-none');

    if (platformName === 'telegram' || platformName === 'vk') {
        if (tabName === 'teachers') platformShowBack();
        else platformHideBack();
    }

    // Keep tab state in URL so browser/VK native back can return to students.
    if (window.location.hash.replace('#', '') !== tabName) {
        window.location.hash = tabName;
    }

    // Lazy-load
    if (tabName === 'students' && !stu.isStudentsLoaded()) stu.loadStudentsData();
    if (tabName === 'teachers' && !tch.isTeachersLoaded()) tch.loadTeachersData();

    storageSet('active_tab', tabName);
}

// ── Events ──
function bindEvents() {
    window.addEventListener('hashchange', function () {
        var tab = window.location.hash.replace('#', '');
        if ((tab === 'students' || tab === 'teachers') && tab !== activeTab) {
            switchTab(tab);
        }
    });

    // Tab switching
    $$('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { switchTab(this.dataset.tab); });
    });

    // --- Students: week navigation ---
    var stuWeekPrev = $('#stu-week-prev');
    var stuWeekNext = $('#stu-week-next');
    var stuWeekToday = $('#stu-week-today');
    if (stuWeekPrev) stuWeekPrev.addEventListener('click', function (e) { e.preventDefault(); stu.changeWeek(-1); });
    if (stuWeekNext) stuWeekNext.addEventListener('click', function (e) { e.preventDefault(); stu.changeWeek(1); });
    if (stuWeekToday) stuWeekToday.addEventListener('click', function (e) { e.preventDefault(); stu.goToCurrentWeek(); });

    // Students: selectors
    var selDept = $('#sel-dept');
    if (selDept) selDept.addEventListener('change', function () { stu.populateCourses(this.value); });
    var selCourse = $('#sel-course');
    if (selCourse) selCourse.addEventListener('change', function () { stu.populateGroups($('#sel-dept').value, this.value); });
    var selGroup = $('#sel-group');
    if (selGroup) selGroup.addEventListener('change', function () { if (this.value) stu.selectGroup(this.value); });

    // Students: search
    var stuSearch = $('#stu-search');
    var stuSearchTimer;
    if (stuSearch) {
        stuSearch.addEventListener('input', function () {
            var v = this.value;
            clearTimeout(stuSearchTimer);
            stuSearchTimer = setTimeout(function () { stu.showSearchResults(v); }, 200);
        });
        stuSearch.addEventListener('blur', function () {
            setTimeout(function () { var dd = $('#stu-search-results'); if (dd) dd.classList.add('d-none'); }, 200);
        });
        stuSearch.addEventListener('focus', function () {
            if (this.value.length >= 2) stu.showSearchResults(this.value);
        });
    }

    // Save group
    var btnSave = $('#btn-save-group');
    if (btnSave) btnSave.addEventListener('click', function () { stu.toggleSaveGroup(); });

    // --- Teachers: week navigation ---
    var tchWeekPrev = $('#tch-week-prev');
    var tchWeekNext = $('#tch-week-next');
    var tchWeekToday = $('#tch-week-today');
    if (tchWeekPrev) tchWeekPrev.addEventListener('click', function (e) { e.preventDefault(); tch.changeWeek(-1); });
    if (tchWeekNext) tchWeekNext.addEventListener('click', function (e) { e.preventDefault(); tch.changeWeek(1); });
    if (tchWeekToday) tchWeekToday.addEventListener('click', function (e) { e.preventDefault(); tch.goToCurrentWeek(); });

    // Teachers: selectors
    var selTchDept = $('#sel-tch-dept');
    if (selTchDept) selTchDept.addEventListener('change', function () { tch.populateStaff(this.value); });
    var selStaff = $('#sel-staff');
    if (selStaff) selStaff.addEventListener('change', function () { if (this.value) tch.selectStaff(this.value); });

    // Teachers: search
    var tchSearch = $('#tch-search');
    var tchSearchTimer;
    if (tchSearch) {
        tchSearch.addEventListener('input', function () {
            var v = this.value;
            clearTimeout(tchSearchTimer);
            tchSearchTimer = setTimeout(function () { tch.showSearchResults(v); }, 200);
        });
        tchSearch.addEventListener('blur', function () {
            setTimeout(function () { var dd = $('#tch-search-results'); if (dd) dd.classList.add('d-none'); }, 200);
        });
        tchSearch.addEventListener('focus', function () {
            if (this.value.length >= 2) tch.showSearchResults(this.value);
        });
    }

    // --- Delegated events ---
    document.addEventListener('click', function (e) {
        // Student search item
        var searchItem = e.target.closest('#stu-search-results .search-item');
        if (searchItem) {
            var gid = searchItem.dataset.id, dk = searchItem.dataset.dept, ck = searchItem.dataset.course;
            var sd = $('#sel-dept');
            if (sd) { sd.value = dk; stu.populateCourses(dk); }
            setTimeout(function () {
                var sc = $('#sel-course');
                if (sc) { sc.value = ck; stu.populateGroups(dk, ck); }
                setTimeout(function () {
                    var sg = $('#sel-group');
                    if (sg) sg.value = gid;
                    stu.selectGroup(gid);
                }, 50);
            }, 50);
            var stuS = $('#stu-search');
            if (stuS) stuS.value = '';
            var stuR = $('#stu-search-results');
            if (stuR) stuR.classList.add('d-none');
            return;
        }

        // Teacher search item
        var tchItem = e.target.closest('#tch-search-results .search-item');
        if (tchItem) {
            var sid = tchItem.dataset.id, dkT = tchItem.dataset.dept;
            var selTD = $('#sel-tch-dept');
            if (selTD) { selTD.value = dkT; tch.populateStaff(dkT); }
            var selST = $('#sel-staff');
            if (selST) selST.value = sid;
            tch.selectStaff(sid);
            var tchS = $('#tch-search');
            if (tchS) tchS.value = '';
            var tchR = $('#tch-search-results');
            if (tchR) tchR.classList.add('d-none');
            return;
        }

        // Saved group remove
        var removeBtn = e.target.closest('.saved-group-remove');
        if (removeBtn) {
            e.stopPropagation();
            stu.removeGroup(removeBtn.dataset.id);
            return;
        }

        // Saved group click
        var savedItem = e.target.closest('.saved-group-item');
        if (savedItem) {
            var gidS = savedItem.dataset.id, dkS = savedItem.dataset.dept, ckS = savedItem.dataset.course;
            var sdS = $('#sel-dept');
            if (sdS) sdS.value = dkS;
            stu.populateCourses(dkS);
            var scS = $('#sel-course');
            if (scS) scS.value = ckS;
            stu.populateGroups(dkS, ckS);
            var sgS = $('#sel-group');
            if (sgS) sgS.value = gidS;
            stu.selectGroup(gidS);
        }
    });

    // Collapsible sidebar toggles (for tg-mode mobile)
    $$('.sidebar-collapse-toggle').forEach(function (toggle) {
        var targetId = toggle.id.replace('-toggle', '-body');
        var body = $('#' + targetId);
        if (!body) return;
        toggle.addEventListener('click', function () {
            var open = body.classList.toggle('open');
            toggle.classList.toggle('open', open);
        });
    });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', function () {
    platformReady(function () {
        if (activeTab === 'teachers') switchTab('students');
    }).then(function () {
        return storageInit();
    }).finally(function () {
        bindEvents();

        var savedTab = storageGet('active_tab') || 'students';
        var hash = window.location.hash.replace('#', '');
        if (hash === 'teachers' || hash === 'students') savedTab = hash;
        switchTab(savedTab);
    });
});
