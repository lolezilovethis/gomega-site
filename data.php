<?php
if (isset($_POST['username']) && isset($_POST['data'])) {
    $username = preg_replace('/[^a-zA-Z0-9_-]/', '', $_POST['username']); // sanitize
    $data = $_POST['data'];

    // Save to file in Data folder
    $filePath = __DIR__ . "/Data/gomega-$username.txt";
    file_put_contents($filePath, $data . "\n\n", FILE_APPEND);

    echo "Data saved successfully.";
} else {
    echo "Invalid request.";
}
?>
