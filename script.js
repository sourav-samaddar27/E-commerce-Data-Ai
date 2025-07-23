document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const askBtn = document.getElementById('askBtn');
    const askBtnText = document.getElementById('askBtnText');
    const askLoader = document.getElementById('askLoader');
    const userInput = document.getElementById('userInput');
    
    const summaryCard = document.getElementById('summaryCard');
    const aiSummary = document.getElementById('aiSummary');
    const sqlCard = document.getElementById('sqlCard');
    const sqlQuery = document.getElementById('sqlQuery');
    const tableCard = document.getElementById('tableCard');
    const resultsTable = document.getElementById('resultsTable');
    const chartCard = document.getElementById('chartCard');
    const errorCard = document.getElementById('errorCard');
    const errorMessage = document.getElementById('errorMessage');
    
    let chartInstance = null; // To hold the chart object

    askBtn.addEventListener('click', handleUserQuery);
    userInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            handleUserQuery();
        }
    });

    function handleUserQuery() {
        const userQuestion = userInput.value.trim();
        if (!userQuestion) {
            showError("Please enter a question.");
            return;
        }

        setLoadingState(true);
        hideAllCards();
        aiSummary.innerHTML = ''; // Clear previous summary

        const eventSource = new EventSource(`http://127.0.0.1:5000/ask?question=${encodeURIComponent(userQuestion)}`);

        eventSource.addEventListener('sql_generated', (e) => {
            const data = JSON.parse(e.data);
            sqlQuery.textContent = data.sql_query;
            sqlCard.classList.remove('hidden');
        });

        eventSource.addEventListener('data_retrieved', (e) => {
            const data = JSON.parse(e.data);
            displayResultsAsTable(data.results);
            tableCard.classList.remove('hidden');
            
            if (data.chart_info && data.chart_info.chart_type !== 'none') {
                renderChart(data.chart_info, data.results);
                chartCard.classList.remove('hidden');
            }
        });

        eventSource.addEventListener('summary_chunk', (e) => {
            const data = JSON.parse(e.data);
            summaryCard.classList.remove('hidden');
            aiSummary.innerHTML += data.chunk;
        });
        
        eventSource.addEventListener('stream_end', (e) => {
            eventSource.close();
            setLoadingState(false);
        });

        eventSource.onerror = (err) => {
            console.error("EventSource failed:", err);
            showError("Failed to connect to the server. Is it running?");
            eventSource.close();
            setLoadingState(false);
        };
    }

    function renderChart(chartInfo, data) {
        if (chartInstance) {
            chartInstance.destroy();
        }
        const ctx = document.getElementById('myChart').getContext('2d');
        
        const labels = data.map(item => item[chartInfo.x_axis]);
        const values = data.map(item => item[chartInfo.y_axis]);

        chartInstance = new Chart(ctx, {
            type: chartInfo.chart_type, // 'bar', 'pie', etc.
            data: {
                labels: labels,
                datasets: [{
                    label: chartInfo.title || chartInfo.y_axis,
                    data: values,
                    backgroundColor: [
                        'rgba(54, 162, 235, 0.6)',
                        'rgba(255, 99, 132, 0.6)',
                        'rgba(255, 206, 86, 0.6)',
                        'rgba(75, 192, 192, 0.6)',
                        'rgba(153, 102, 255, 0.6)',
                        'rgba(255, 159, 64, 0.6)'
                    ],
                    borderColor: [
                        'rgba(54, 162, 235, 1)',
                        'rgba(255, 99, 132, 1)',
                        'rgba(255, 206, 86, 1)',
                        'rgba(75, 192, 192, 1)',
                        'rgba(153, 102, 255, 1)',
                        'rgba(255, 159, 64, 1)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: chartInfo.title,
                        font: {
                            size: 16
                        }
                    }
                }
            }
        });
    }

    function displayResultsAsTable(data) {
        resultsTable.innerHTML = '';
        if (!data || data.length === 0) {
            resultsTable.innerHTML = '<p class="text-gray-500">No data returned from this query.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200';

        const thead = document.createElement('thead');
        thead.className = 'bg-gray-50';
        const headerRow = document.createElement('tr');
        Object.keys(data[0]).forEach(key => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
            th.textContent = key;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        tbody.className = 'bg-white divide-y divide-gray-200';
        data.forEach(row => {
            const tr = document.createElement('tr');
            Object.values(row).forEach(value => {
                const td = document.createElement('td');
                td.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-700';
                td.textContent = (typeof value === 'number' && !Number.isInteger(value)) ? value.toFixed(2) : value;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        resultsTable.appendChild(table);
    }

    function setLoadingState(isLoading) {
        askBtn.disabled = isLoading;
        if (isLoading) {
            askBtnText.classList.add('hidden');
            askLoader.classList.remove('hidden');
        } else {
            askBtnText.classList.remove('hidden');
            askLoader.classList.add('hidden');
        }
    }

    function hideAllCards() {
        summaryCard.classList.add('hidden');
        sqlCard.classList.add('hidden');
        tableCard.classList.add('hidden');
        chartCard.classList.add('hidden');
        errorCard.classList.add('hidden');
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorCard.classList.remove('hidden');
    }
});
