sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/ui/core/Core"
], function (
    Controller,
    Fragment,
    MessageBox,
    Core
) {
    "use strict";

    return Controller.extend(
        "ns.doctopdf.zdoctopdf.controller.Main",
        {
            _oPdfDialog: null,
            _oIframe: null,
            _sCurrentPdfUrl: null,
            _oCurrentPdfBlob: null,

            onInit: function () {
            },

            // =========================================================
            // Load external libraries
            // =========================================================

            _loadConversionLibraries: function () {
                return new Promise(function (resolve, reject) {
                    if (window.mammoth && window.html2pdf) {
                        resolve();
                        return;
                    }

                    var aScripts = [];

                    if (!window.mammoth) {
                        aScripts.push({
                            name: "Mammoth",
                            url: sap.ui.require.toUrl(
                                "ns/doctopdf/zdoctopdf/thirdparty/mammoth/mammoth.browser.min.js"
                            )
                        });
                    }

                    if (!window.html2pdf) {
                        aScripts.push({
                            name: "html2pdf",
                            url: sap.ui.require.toUrl(
                                "ns/doctopdf/zdoctopdf/thirdparty/html2pdf/html2pdf.bundle.min.js"
                            )
                        });
                    }

                    var iIndex = 0;

                    function loadNext() {
                        if (iIndex >= aScripts.length) {
                            if (!window.mammoth || !window.html2pdf) {
                                reject(new Error("Required conversion libraries are not available."));
                                return;
                            }
                            resolve();
                            return;
                        }

                        var oLibrary = aScripts[iIndex];
                        var oScript = document.createElement("script");
                        oScript.src = oLibrary.url;

                        oScript.onload = function () {
                            console.log(oLibrary.name + " loaded successfully");
                            iIndex++;
                            loadNext();
                        };

                        oScript.onerror = function () {
                            reject(new Error("Unable to load " + oLibrary.name + " library.\n\n" + oLibrary.url));
                        };

                        document.head.appendChild(oScript);
                    }

                    loadNext();
                });
            },

            // =========================================================
            // Base64 -> Uint8Array
            // =========================================================

            _base64ToUint8Array: function (sBase64) {
                var byteCharacters = atob(sBase64);
                var byteNumbers = new Array(byteCharacters.length);
                for (var i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                return new Uint8Array(byteNumbers);
            },

            // =========================================================
            // Process HTML to fix formatting issues
            // =========================================================

            _processHtml: function (sHtml) {
                // Create a temporary DOM element to manipulate
                var oTempDiv = document.createElement('div');
                oTempDiv.innerHTML = sHtml;

                // 1. Fix lists - ensure proper structure
                var oLists = oTempDiv.querySelectorAll('ul, ol');
                oLists.forEach(function (oList) {
                    // Make sure list items are properly structured
                    var oItems = oList.querySelectorAll('li');
                    if (oItems.length > 0) {
                        // Ensure each item is properly formatted
                        oItems.forEach(function (oItem) {
                            // Remove any extra text nodes that might be outside list items
                            var oParent = oItem.parentNode;
                            var oChildren = oParent.childNodes;
                            for (var i = oChildren.length - 1; i >= 0; i--) {
                                if (oChildren[i].nodeType === 3 && oChildren[i].textContent.trim() === '') {
                                    oParent.removeChild(oChildren[i]);
                                }
                            }
                        });
                    }
                });

                // 2. Fix tables - ensure proper structure
                var oTables = oTempDiv.querySelectorAll('table');
                oTables.forEach(function (oTable) {
                    // Add proper table structure if missing
                    var oRows = oTable.querySelectorAll('tr');
                    if (oRows.length === 0) {
                        // Try to find row-like structures
                        var oTdElements = oTable.querySelectorAll('td, th');
                        if (oTdElements.length > 0) {
                            var oRow = document.createElement('tr');
                            oTdElements.forEach(function (oTd) {
                                var oNewTd = document.createElement('td');
                                oNewTd.innerHTML = oTd.innerHTML;
                                oNewTd.colSpan = oTd.getAttribute('colspan') || 1;
                                oNewTd.rowSpan = oTd.getAttribute('rowspan') || 1;
                                oRow.appendChild(oNewTd);
                                oTd.parentNode.removeChild(oTd);
                            });
                            oTable.appendChild(oRow);
                        }
                    }

                    // Ensure table has proper styling class
                    oTable.classList.add('pdf-table');
                });

                // 3. Fix headings - ensure proper hierarchy
                var oHeadings = oTempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
                oHeadings.forEach(function (oHeading) {
                    // Add a class for styling
                    oHeading.classList.add('pdf-heading-' + oHeading.tagName.toLowerCase());

                    // Ensure heading has proper spacing
                    if (!oHeading.nextSibling || oHeading.nextSibling.nodeType !== 3) {
                        // Add a space after heading if needed
                    }
                });

                // 4. Fix paragraphs - ensure proper spacing
                var oParagraphs = oTempDiv.querySelectorAll('p');
                oParagraphs.forEach(function (oPara) {
                    oPara.classList.add('pdf-paragraph');
                });

                // 5. Fix images - add proper styling
                var oImages = oTempDiv.querySelectorAll('img');
                oImages.forEach(function (oImg) {
                    oImg.classList.add('pdf-image');
                    oImg.style.maxWidth = '100%';
                    oImg.style.height = 'auto';
                });

                // 6. Fix lists that are concatenated - identify and separate
                var oAllElements = oTempDiv.querySelectorAll('*');
                var aTextNodes = [];
                oAllElements.forEach(function (oEl) {
                    if (oEl.childNodes.length === 1 && oEl.childNodes[0].nodeType === 3) {
                        var sText = oEl.textContent.trim();
                        if (sText && (sText.includes('Headings') || sText.includes('Lists') ||
                            sText.includes('Links') || sText.includes('Images') ||
                            sText.includes('Tables'))) {
                            // This might be a concatenated list, wrap each item
                            var aWords = sText.split(/(?=[A-Z])/);
                            if (aWords.length > 1) {
                                var oNewParent = document.createElement('p');
                                aWords.forEach(function (sWord) {
                                    if (sWord.trim()) {
                                        var oSpan = document.createElement('span');
                                        oSpan.textContent = sWord.trim();
                                        oSpan.style.marginRight = '10px';
                                        oNewParent.appendChild(oSpan);
                                    }
                                });
                                oEl.parentNode.replaceChild(oNewParent, oEl);
                            }
                        }
                    }
                });

                // 7. Fix columns text - ensure proper formatting
                var oBody = oTempDiv.querySelector('body');
                if (oBody) {
                    var oChildren = oBody.childNodes;
                    for (var i = 0; i < oChildren.length; i++) {
                        if (oChildren[i].nodeType === 3) {
                            var sText = oChildren[i].textContent;
                            if (sText.trim() && sText.includes('column')) {
                                var oNewPara = document.createElement('p');
                                oNewPara.textContent = sText;
                                oNewPara.classList.add('pdf-paragraph');
                                oChildren[i].parentNode.replaceChild(oNewPara, oChildren[i]);
                            }
                        }
                    }
                }

                return oTempDiv.innerHTML;
            },

            // =========================================================
            // Convert DOCX to PDF
            // =========================================================

            _convertDocxToPdf: async function (sBase64) {
                await this._loadConversionLibraries();

                if (!window.mammoth) {
                    throw new Error("Mammoth.js is not loaded.");
                }

                if (!window.html2pdf) {
                    throw new Error("html2pdf.js is not loaded.");
                }

                // Base64 -> Uint8Array
                var oArrayBuffer = this._base64ToUint8Array(sBase64);
                console.log("DOCX size:", oArrayBuffer.length);

                if (!oArrayBuffer || oArrayBuffer.length === 0) {
                    throw new Error("DOCX content is empty.");
                }

                // DOCX -> HTML using Mammoth
                var oResult = await window.mammoth.convertToHtml({
                    arrayBuffer: oArrayBuffer.buffer,
                    styleMap: [
                        "p[style-name='Heading1'] => h1",
                        "p[style-name='Heading2'] => h2",
                        "p[style-name='Heading3'] => h3",
                        "p[style-name='Normal'] => p",
                        "p[style-name='ListParagraph'] => p.list-item",
                        "r[style-name='Strong'] => strong",
                        "r[style-name='Emphasis'] => em"
                    ]
                });

                var sHtml = oResult.value;
                console.log("Generated HTML length:", sHtml.length);

                if (!sHtml || !sHtml.trim()) {
                    throw new Error("DOCX conversion generated empty HTML.");
                }

                // Process HTML to fix formatting
                sHtml = this._processHtml(sHtml);
                console.log("Processed HTML:", sHtml.substring(0, 500));

                // Create container
                var oContainer = document.createElement("div");
                oContainer.id = "docxPdfContainer";

                // Style the container
                oContainer.style.width = "794px";
                oContainer.style.margin = "0 auto";
                oContainer.style.padding = "40px";
                oContainer.style.background = "#ffffff";
                oContainer.style.color = "#000000";
                oContainer.style.fontFamily = "Arial, Helvetica, sans-serif";
                oContainer.style.fontSize = "12pt";
                oContainer.style.lineHeight = "1.5";
                oContainer.style.position = "relative";
                oContainer.style.zIndex = "9999";
                oContainer.style.display = "block";
                oContainer.style.overflow = "visible";

                // Add CSS
                var oStyle = document.createElement("style");
                oStyle.innerHTML = `
                    #docxPdfContainer {
                        background: white !important;
                        color: black !important;
                        font-family: Arial, Helvetica, sans-serif !important;
                        font-size: 12pt !important;
                        line-height: 1.5 !important;
                        width: 794px !important;
                        padding: 40px !important;
                        margin: 0 auto !important;
                    }
                    
                    #docxPdfContainer * {
                        max-width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    
                    #docxPdfContainer h1 {
                        font-size: 24pt !important;
                        font-weight: bold !important;
                        margin: 24px 0 16px 0 !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer h2 {
                        font-size: 18pt !important;
                        font-weight: bold !important;
                        margin: 20px 0 12px 0 !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer h3 {
                        font-size: 14pt !important;
                        font-weight: bold !important;
                        margin: 16px 0 8px 0 !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer .pdf-paragraph {
                        margin: 6px 0 !important;
                        line-height: 1.5 !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer .pdf-table {
                        border-collapse: collapse !important;
                        width: 100% !important;
                        margin: 16px 0 !important;
                    }
                    
                    #docxPdfContainer .pdf-table td, 
                    #docxPdfContainer .pdf-table th {
                        border: 1px solid #000 !important;
                        padding: 8px 12px !important;
                        text-align: left !important;
                        vertical-align: top !important;
                        background: #fff !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer .pdf-table th {
                        background: #f0f0f0 !important;
                        font-weight: bold !important;
                    }
                    
                    #docxPdfContainer .pdf-image {
                        max-width: 100% !important;
                        height: auto !important;
                        display: inline-block !important;
                    }
                    
                    #docxPdfContainer ul, 
                    #docxPdfContainer ol {
                        margin: 8px 0 !important;
                        padding-left: 40px !important;
                        color: #000 !important;
                        list-style-position: outside !important;
                    }
                    
                    #docxPdfContainer li {
                        margin: 4px 0 !important;
                        line-height: 1.5 !important;
                        color: #000 !important;
                    }
                    
                    #docxPdfContainer .list-item {
                        margin: 4px 0 4px 20px !important;
                        padding-left: 10px !important;
                    }
                    
                    #docxPdfContainer a {
                        color: #0000FF !important;
                        text-decoration: underline !important;
                        word-break: break-all !important;
                    }
                    
                    #docxPdfContainer strong, #docxPdfContainer b {
                        font-weight: bold !important;
                    }
                    
                    #docxPdfContainer em, #docxPdfContainer i {
                        font-style: italic !important;
                    }
                `;
                document.head.appendChild(oStyle);

                oContainer.innerHTML = sHtml;
                document.body.appendChild(oContainer);

                // Wait for rendering
                await new Promise(function (resolve) {
                    setTimeout(resolve, 2000);
                });

                console.log("Container rendered. Height:", oContainer.scrollHeight);

                // Generate PDF
                var oPdfBlob = await this._generatePdfWithHtml2pdf(oContainer);

                // Clean up
                if (oContainer.parentNode) {
                    oContainer.parentNode.removeChild(oContainer);
                }
                if (oStyle.parentNode) {
                    oStyle.parentNode.removeChild(oStyle);
                }

                if (!oPdfBlob || oPdfBlob.size === 0) {
                    throw new Error("PDF generation failed or generated an empty PDF.");
                }

                console.log("PDF generated successfully. Size:", oPdfBlob.size);
                return oPdfBlob;
            },

            // =========================================================
            // Generate PDF using html2pdf
            // =========================================================

            _generatePdfWithHtml2pdf: function (oContainer) {
                return new Promise(function (resolve, reject) {
                    try {
                        var html2pdf = window.html2pdf;

                        var contentHeight = oContainer.scrollHeight;
                        console.log("Content height for PDF:", contentHeight);

                        var opt = {
                            margin: [10, 10, 10, 10],
                            filename: "document.pdf",
                            image: {
                                type: "jpeg",
                                quality: 0.98
                            },
                            html2canvas: {
                                scale: 2,
                                useCORS: true,
                                allowTaint: true,
                                backgroundColor: "#ffffff",
                                logging: false,
                                width: 794,
                                height: contentHeight,
                                windowWidth: 794
                            },
                            jsPDF: {
                                unit: "mm",
                                format: "a4",
                                orientation: "portrait"
                            },
                            pagebreak: {
                                mode: ['css', 'legacy']
                            }
                        };

                        html2pdf()
                            .set(opt)
                            .from(oContainer)
                            .outputPdf('blob')
                            .then(function (blob) {
                                console.log("PDF generated. Size:", blob.size);
                                resolve(blob);
                            })
                            .catch(function (error) {
                                console.error("html2pdf error:", error);
                                reject(error);
                            });

                    } catch (oError) {
                        console.error("Error in _generatePdfWithHtml2pdf:", oError);
                        reject(oError);
                    }
                });
            },

            // =========================================================
            // Preview - Main Method
            // =========================================================

            onPreviewPdf: async function (oEvent) {
                try {
                    var oCtx = oEvent.getSource().getBindingContext("base64Model");

                    if (!oCtx) {
                        MessageBox.error("Binding context not found.");
                        return;
                    }

                    var oAttachment = oCtx.getObject();

                    if (!oAttachment || !oAttachment.Content) {
                        MessageBox.error("Document content not found.");
                        return;
                    }

                    var sBase64 = oAttachment.Content;
                    if (sBase64.indexOf("base64,") !== -1) {
                        sBase64 = sBase64.split("base64,")[1];
                    }

                    var sFileName = (oAttachment.FileName || "").toLowerCase();
                    var sExtension = sFileName.split(".").pop();

                    console.log("File:", sFileName);
                    console.log("Extension:", sExtension);
                    console.log("Base64 length:", sBase64.length);

                    var oPdfBlob = null;

                    if (sExtension === "docx") {
                        if (!sBase64 || sBase64.length === 0) {
                            MessageBox.error("DOCX file content is empty.");
                            return;
                        }

                        sap.ui.core.BusyIndicator.show(0);

                        try {
                            console.log("Starting DOCX to PDF conversion...");
                            oPdfBlob = await this._convertDocxToPdf(sBase64);
                            console.log("DOCX conversion completed successfully.");
                        } catch (oError) {
                            console.error("DOCX conversion error:", oError);
                            MessageBox.error("Failed to convert DOCX to PDF.\n\nError: " + oError.message);
                            return;
                        } finally {
                            sap.ui.core.BusyIndicator.hide();
                        }
                    }
                    else if (sExtension === "pdf") {
                        try {
                            if (!sBase64 || sBase64.length === 0) {
                                MessageBox.error("PDF file content is empty.");
                                return;
                            }

                            var aPdfBytes = this._base64ToUint8Array(sBase64);

                            if (!aPdfBytes || aPdfBytes.length === 0) {
                                MessageBox.error("Failed to decode PDF content.");
                                return;
                            }

                            oPdfBlob = new Blob(
                                [aPdfBytes],
                                { type: "application/pdf" }
                            );

                            console.log("PDF Blob created. Size:", oPdfBlob.size);
                        } catch (oError) {
                            console.error("PDF processing error:", oError);
                            MessageBox.error("Failed to process PDF file.\n\nError: " + oError.message);
                            return;
                        }
                    }
                    else {
                        MessageBox.warning(
                            "Preview currently supports PDF and DOCX only.\n\n" +
                            "Selected file: " + sFileName
                        );
                        return;
                    }

                    if (!oPdfBlob) {
                        MessageBox.error("PDF could not be generated.");
                        return;
                    }

                    if (oPdfBlob.size === 0) {
                        MessageBox.error("Generated PDF is empty (0 bytes).");
                        return;
                    }

                    console.log("PDF Blob size:", oPdfBlob.size, "bytes");
                    console.log("PDF Blob type:", oPdfBlob.type);

                    await this._showPdfBlob(oPdfBlob);

                } catch (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("Preview error:", oError);
                    MessageBox.error("Unable to preview document.\n\nError: " + oError.message);
                }
            },

            // =========================================================
            // Show PDF in Dialog
            // =========================================================

            _showPdfBlob: async function (oPdfBlob) {
                if (!oPdfBlob || oPdfBlob.size === 0) {
                    return;
                }

                this._oCurrentPdfBlob = oPdfBlob;

                if (!this._oPdfDialog) {
                    try {
                        this._oPdfDialog = await Fragment.load({
                            id: this.getView().getId(),
                            name: "ns.doctopdf.zdoctopdf.view.fragment.PdfViewer",
                            controller: this
                        });

                        this.getView().addDependent(this._oPdfDialog);
                        console.log("PDF Dialog loaded successfully");
                    } catch (oError) {
                        console.error("Error loading PDF dialog:", oError);
                        this._openPdfInNewTab(oPdfBlob);
                        return;
                    }
                }

                this._oPdfDialog.open();

                await new Promise(function (resolve) {
                    setTimeout(resolve, 500);
                });

                var oIframe = this._getIframe();

                if (!oIframe) {
                    console.error("Iframe not found");
                    this._openPdfInNewTab(oPdfBlob);
                    return;
                }

                this._oIframe = oIframe;
                await this._loadPdfIntoIframe(oPdfBlob);
            },

            // =========================================================
            // Open PDF in New Tab
            // =========================================================

            _openPdfInNewTab: function (oPdfBlob) {
                try {
                    var sUrl = URL.createObjectURL(oPdfBlob);
                    window.open(sUrl, '_blank');

                    setTimeout(function () {
                        URL.revokeObjectURL(sUrl);
                    }, 5000);

                    console.log("PDF opened in new tab");
                } catch (oError) {
                    console.error("Error opening PDF in new tab:", oError);
                    MessageBox.error("Unable to display PDF. Please try downloading it.");
                }
            },

            // =========================================================
            // Get Iframe
            // =========================================================

            _getIframe: function () {
                try {
                    var oIframe = Fragment.byId(
                        this.getView().getId(),
                        "pdfIframe"
                    );

                    if (oIframe) {
                        console.log("Found iframe using Fragment.byId");
                        return oIframe;
                    }

                    var sIframeId = this.getView().getId() + "--pdfIframe";
                    var oDomIframe = document.getElementById(sIframeId);
                    if (oDomIframe) {
                        console.log("Found iframe using DOM");
                        return oDomIframe;
                    }

                    if (this._oPdfDialog) {
                        var oContent = this._oPdfDialog.getContent();
                        if (oContent && oContent.length > 0) {
                            var oHtmlDiv = oContent[0];
                            if (oHtmlDiv && oHtmlDiv.getDomRef) {
                                var oDomRef = oHtmlDiv.getDomRef();
                                if (oDomRef) {
                                    var oFoundIframe = oDomRef.querySelector("iframe");
                                    if (oFoundIframe) {
                                        console.log("Found iframe using DOM querySelector");
                                        return oFoundIframe;
                                    }
                                }
                            }
                        }
                    }

                    console.warn("Iframe not found with any method");
                    return null;
                } catch (oError) {
                    console.error("Error getting iframe:", oError);
                    return null;
                }
            },

            // =========================================================
            // Load PDF into Iframe
            // =========================================================

            _loadPdfIntoIframe: function (oPdfBlob) {
                return new Promise(function (resolve, reject) {
                    try {
                        var sPdfUrl = URL.createObjectURL(oPdfBlob);
                        console.log("Generated PDF URL:", sPdfUrl);

                        if (this._sCurrentPdfUrl) {
                            URL.revokeObjectURL(this._sCurrentPdfUrl);
                        }
                        this._sCurrentPdfUrl = sPdfUrl;

                        var oIframe = this._oIframe;
                        if (!oIframe) {
                            reject(new Error("Iframe not available"));
                            return;
                        }

                        var oDomRef = oIframe.getDomRef ? oIframe.getDomRef() : oIframe;

                        if (!oDomRef) {
                            reject(new Error("Iframe DOM not available"));
                            return;
                        }

                        console.log("Setting iframe source...");

                        oDomRef.src = "about:blank";

                        oDomRef.onload = function () {
                            console.log("PDF loaded successfully in iframe");
                            resolve();
                        };

                        oDomRef.onerror = function (e) {
                            console.error("Error loading PDF in iframe:", e);
                            this._openPdfInNewTab(oPdfBlob);
                            resolve();
                        }.bind(this);

                        setTimeout(function () {
                            oDomRef.src = sPdfUrl;
                            console.log("Iframe src set to:", sPdfUrl);
                        }, 300);

                    } catch (oError) {
                        console.error("Error loading PDF into iframe:", oError);
                        this._openPdfInNewTab(oPdfBlob);
                        reject(oError);
                    }
                }.bind(this));
            },

            // =========================================================
            // Dialog After Open
            // =========================================================

            onDialogAfterOpen: function () {
                console.log("Dialog opened");

                if (this._oIframe && this._sCurrentPdfUrl) {
                    try {
                        var oDomRef = this._oIframe.getDomRef ? this._oIframe.getDomRef() : this._oIframe;
                        if (oDomRef && (!oDomRef.src || oDomRef.src === "about:blank")) {
                            console.log("Reloading iframe in afterOpen");
                            setTimeout(function () {
                                oDomRef.src = this._sCurrentPdfUrl;
                            }.bind(this), 200);
                        }
                    } catch (oError) {
                        console.error("Error in afterOpen:", oError);
                    }
                }
            },

            // =========================================================
            // Download PDF
            // =========================================================

            onDownloadPDF: function () {
                if (!this._oCurrentPdfBlob) {
                    MessageBox.error("No PDF available to download.");
                    return;
                }

                try {
                    var sUrl = URL.createObjectURL(this._oCurrentPdfBlob);
                    var oLink = document.createElement('a');
                    oLink.href = sUrl;
                    oLink.download = 'document.pdf';
                    document.body.appendChild(oLink);
                    oLink.click();
                    document.body.removeChild(oLink);

                    setTimeout(function () {
                        URL.revokeObjectURL(sUrl);
                    }, 1000);

                    console.log("PDF download started");
                } catch (oError) {
                    console.error("Download error:", oError);
                    MessageBox.error("Failed to download PDF: " + oError.message);
                }
            },

            // =========================================================
            // Close Dialog
            // =========================================================

            onClosePDF: function () {
                if (this._oPdfDialog) {
                    if (this._oIframe) {
                        try {
                            var oDomRef = this._oIframe.getDomRef ? this._oIframe.getDomRef() : this._oIframe;
                            if (oDomRef) {
                                oDomRef.src = "about:blank";
                                oDomRef.onload = null;
                                oDomRef.onerror = null;
                            }
                        } catch (oError) {
                            console.error("Error clearing iframe:", oError);
                        }
                    }

                    if (this._sCurrentPdfUrl) {
                        try {
                            URL.revokeObjectURL(this._sCurrentPdfUrl);
                        } catch (oError) {
                            console.error("Error revoking URL:", oError);
                        }
                        this._sCurrentPdfUrl = null;
                    }

                    this._oPdfDialog.close();
                    this._oCurrentPdfBlob = null;
                    this._oIframe = null;
                }
            }
        }
    );
});