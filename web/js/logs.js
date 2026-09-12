document.addEventListener("DOMContentLoaded", function () {
    function fetchLogs() {
        document.getElementById("mainLogContent").innerHTML = "<p>Fetching logs...</p>";
        setTimeout(() => {
            document.getElementById("mainLogContent").innerHTML = "<p>Logs loaded successfully!</p>";
        }, 1000);
    }

    fetchLogs();
});
