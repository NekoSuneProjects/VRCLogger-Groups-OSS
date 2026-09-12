document.addEventListener("DOMContentLoaded", function () {
    const assetsTable = document.getElementById("assets-blacklistContent");

    if (assetsTable) {
        assetsTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Timestamp</th>
                        <th>UserID</th>
                        <th>DisplayName</th>
                        <th>Image</th>
                    </tr>
                </thead>
                <tbody id="assetsTableBody"></tbody>
            </table>`;
    }
});
